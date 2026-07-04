#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderProjectWithBridge } from '../scripts/continuity-render-bridge.mjs';
import {
  applyGrayboxRender,
  applyShotRenders,
  createAgentProject,
  placeObjects,
  planShots,
  setPanoOrigin,
  summarizeProject,
} from '../src/mcp/projectMutations';
import { exportStoryboardPackage } from '../src/mcp/storyboard';
import { serializeProject } from '../src/engine/projectIO';
import { WorkspaceManager } from './workspace';
import type { Vec3 } from '../src/domain/types';

const sceneObjectTypeSchema = z.enum([
  'floor',
  'wall',
  'box',
  'arch',
  'doorway',
  'column',
  'stairs',
  'tree_blob',
  'terrain_mass',
  'background_card',
  'human_dummy',
  'sun_marker',
]);

const vec3Schema = z.custom<Vec3>((value) => (
  Array.isArray(value)
  && value.length === 3
  && value.every((entry) => typeof entry === 'number')
));

const workspace = new WorkspaceManager();
await workspace.init();

const server = new McpServer({
  name: 'continuity-stage',
  version: '0.1.0',
});

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

server.tool(
  'continuity_create_storyboard',
  'Create a new Continuity Stage workspace and seed project for an agent-authored storyboard.',
  {
    name: z.string().describe('Project/storyboard name.'),
    description: z.string().optional().describe('Optional project description.'),
    videoBrief: z.string().optional().describe('Natural-language video idea that informed the storyboard.'),
  },
  async ({ name, description, videoBrief }) => {
    const record = await workspace.createWorkspace(name);
    const project = createAgentProject({ name, description, videoBrief });
    await workspace.saveProject(project, record.id);

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      summary: summarizeProject(project),
      message: 'Open the project file in Continuity Stage via the normal Load Project flow when you want to refine it in the UI.',
    });
  },
);

server.tool(
  'continuity_place_objects',
  'Add graybox primitives to the active workspace project.',
  {
    workspaceId: z.string().optional(),
    snapToGrid: z.boolean().optional(),
    objects: z.array(z.object({
      type: sceneObjectTypeSchema,
      name: z.string().optional(),
      position: vec3Schema.optional(),
      rotation: vec3Schema.optional(),
      scale: vec3Schema.optional(),
      dimensions: vec3Schema.optional(),
      locked: z.boolean().optional(),
      visible: z.boolean().optional(),
    })).min(1),
  },
  async ({ workspaceId, snapToGrid, objects }) => {
    let project = await workspace.loadProject(workspaceId);
    project = placeObjects(project, objects, { snapToGrid });
    const record = await workspace.saveProject(project, workspaceId);

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      placedCount: objects.length,
      summary: summarizeProject(project),
    });
  },
);

server.tool(
  'continuity_set_pano_origin',
  'Set the pano origin used for graybox 360 rendering.',
  {
    workspaceId: z.string().optional(),
    position: vec3Schema,
  },
  async ({ workspaceId, position }) => {
    let project = await workspace.loadProject(workspaceId);
    project = setPanoOrigin(project, position);
    const record = await workspace.saveProject(project, workspaceId);

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      panoOrigin: project.scene.panoOrigin,
      summary: summarizeProject(project),
    });
  },
);

server.tool(
  'continuity_plan_shots',
  'Replace the shot list for the active workspace with storyboard beats and camera framing.',
  {
    workspaceId: z.string().optional(),
    shots: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      camera: z.object({
        position: vec3Schema,
        target: vec3Schema,
        fovDegrees: z.number().optional(),
      }),
    })).min(1),
  },
  async ({ workspaceId, shots }) => {
    let project = await workspace.loadProject(workspaceId);
    project = planShots(project, shots);
    const record = await workspace.saveProject(project, workspaceId);

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      shotCount: project.shots.length,
      summary: summarizeProject(project),
    });
  },
);

server.tool(
  'continuity_render_storyboard',
  'Render graybox reference images for the active workspace using the headless render bridge.',
  {
    workspaceId: z.string().optional(),
    includeGraybox: z.boolean().optional(),
    includeShotFrames: z.boolean().optional(),
    shotIds: z.array(z.string()).optional(),
    exportPackage: z.boolean().optional(),
    videoBrief: z.string().optional(),
  },
  async ({
    workspaceId,
    includeGraybox = true,
    includeShotFrames = true,
    shotIds,
    exportPackage = true,
    videoBrief,
  }) => {
    const project = await workspace.loadProject(workspaceId);
    const projectJson = serializeProject(project);
    const renders = await renderProjectWithBridge(projectJson, {
      includeGraybox,
      includeShotFrames,
      shotIds,
    });

    let nextProject = project;
    let globalGrayboxDataUrl: string | undefined;

    if (renders.graybox) {
      nextProject = applyGrayboxRender(nextProject, renders.graybox);
      globalGrayboxDataUrl = renders.graybox.dataUrl;
    }

    if (renders.shotFrames?.length) {
      nextProject = applyShotRenders(nextProject, renders.shotFrames.map((frame) => ({
        shotId: frame.shotId,
        shotNumber: frame.shotNumber,
        render: {
          dataUrl: frame.dataUrl,
          width: frame.width,
          height: frame.height,
        },
      })));
    }

    const record = await workspace.saveProject(nextProject, workspaceId);

    let exportPaths;
    if (exportPackage) {
      const shotFrameDataUrls = Object.fromEntries(
        (renders.shotFrames ?? []).map((frame) => [frame.shotId, frame.dataUrl]),
      );
      exportPaths = await exportStoryboardPackage({
        project: nextProject,
        workspaceDir: record.directory,
        sourceBrief: videoBrief,
        globalGrayboxDataUrl,
        shotFrameDataUrls,
      });
    }

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      renderedGraybox: Boolean(renders.graybox),
      renderedShotCount: renders.shotFrames?.length ?? 0,
      export: exportPaths,
      summary: summarizeProject(nextProject),
    });
  },
);

server.tool(
  'continuity_get_project',
  'Return project metadata and file paths for the active workspace without embedding image data.',
  {
    workspaceId: z.string().optional(),
  },
  async ({ workspaceId }) => {
    const record = workspace.getWorkspace(workspaceId);
    if (!record) {
      throw new Error('No active workspace. Create one with continuity_create_storyboard first.');
    }
    const project = await workspace.loadProject(workspaceId);

    return textResult({
      workspaceId: record.id,
      projectFile: record.projectFile,
      workspaceDirectory: record.directory,
      summary: summarizeProject(project),
    });
  },
);

server.tool(
  'continuity_list_workspaces',
  'List MCP workspaces and identify the active one.',
  {},
  async () => textResult({
    activeWorkspaceId: workspace.getActiveWorkspaceId(),
    workspaceRoot: workspace.getRoot(),
    workspaces: workspace.listWorkspaces(),
  }),
);

server.tool(
  'continuity_set_active_workspace',
  'Switch the active MCP workspace.',
  {
    workspaceId: z.string(),
  },
  async ({ workspaceId }) => {
    const record = await workspace.setActiveWorkspace(workspaceId);
    return textResult({
      activeWorkspaceId: record.id,
      projectFile: record.projectFile,
      name: record.name,
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);