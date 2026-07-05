import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

const vec3Schema = z
  .array(z.number())
  .length(3)
  .describe('3D vector [x, y, z]') as unknown as z.ZodType<Vec3>;

const workspace = new WorkspaceManager();
let workspaceReady: Promise<void> | undefined;

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function ensureWorkspace() {
  if (!workspaceReady) {
    workspaceReady = workspace.init();
  }
  await workspaceReady;
}

export async function createContinuityMcpServer() {
  await ensureWorkspace();

  const server = new McpServer({
    name: 'continuity-stage',
    version: '0.1.0',
  });

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
      workspaceId: z.string().optional().describe('Active workspace ID. Omit to use the current active workspace.'),
      snapToGrid: z.boolean().optional().describe('Snap object positions to the grid.'),
      objects: z.array(z.object({
        type: sceneObjectTypeSchema.describe('Primitive shape type.'),
        name: z.string().optional().describe('Optional display name for the object.'),
        position: vec3Schema.optional(),
        rotation: vec3Schema.optional(),
        scale: vec3Schema.optional(),
        dimensions: vec3Schema.optional(),
        locked: z.boolean().optional().describe('Prevent the object from being moved in the UI.'),
        visible: z.boolean().optional().describe('Show or hide the object.'),
      })).min(1).describe('Graybox primitives to add to the scene.'),
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
      workspaceId: z.string().optional().describe('Active workspace ID. Omit to use the current active workspace.'),
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
      workspaceId: z.string().optional().describe('Active workspace ID. Omit to use the current active workspace.'),
      shots: z.array(z.object({
        name: z.string().describe('Shot name, e.g. "Opening Wide" or "Close-up on subject".'),
        description: z.string().optional().describe('Natural-language description of the shot content.'),
        camera: z.object({
          position: vec3Schema,
          target: vec3Schema,
          fovDegrees: z.number().optional().describe('Vertical field of view in degrees. Defaults to 50.'),
        }).describe('Camera framing for this shot.'),
      })).min(1).describe('Storyboard shots to replace the current shot list.'),
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
      workspaceId: z.string().optional().describe('Active workspace ID. Omit to use the current active workspace.'),
      includeGraybox: z.boolean().optional().describe('Render the 360-degree graybox panorama.'),
      includeShotFrames: z.boolean().optional().describe('Render individual shot frames.'),
      shotIds: z.array(z.string()).optional().describe('Specific shot IDs to render. Omit to render all shots.'),
      exportPackage: z.boolean().optional().describe('Export rendered assets to the workspace directory.'),
      videoBrief: z.string().optional().describe('Original video brief for export metadata.'),
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
      workspaceId: z.string().optional().describe('Active workspace ID. Omit to use the current active workspace.'),
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
      workspaceId: z.string().describe('The workspace ID to switch to.'),
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

  return server;
}