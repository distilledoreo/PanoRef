import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocationProject } from '../domain/types';
import { serializeProject } from '../engine/projectIO';
import { slugifyName } from '../utils/ids';

export interface StoryboardBeat {
  order: number;
  shotId: string;
  shotNumber: string;
  name: string;
  description: string;
  framePath?: string;
}

export interface StoryboardManifest {
  name: string;
  sourceBrief: string;
  projectFile: string;
  globalGrayboxPath?: string;
  beats: StoryboardBeat[];
  createdAt: string;
}

export interface StoryboardExportPaths {
  directory: string;
  projectFile: string;
  manifestFile: string;
  globalGrayboxFile?: string;
  shotFrameFiles: Record<string, string>;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Buffer.from(base64, 'base64');
}

export async function exportStoryboardPackage(params: {
  project: LocationProject;
  workspaceDir: string;
  sourceBrief?: string;
  globalGrayboxDataUrl?: string;
  shotFrameDataUrls?: Record<string, string>;
}): Promise<StoryboardExportPaths> {
  const slug = slugifyName(params.project.name);
  const directory = join(params.workspaceDir, slug);
  const shotsDir = join(directory, 'shots');
  await mkdir(shotsDir, { recursive: true });

  const projectFile = join(directory, `${slug}_continuity_stage.json`);
  await writeFile(projectFile, serializeProject(params.project), 'utf8');

  let globalGrayboxFile: string | undefined;
  if (params.globalGrayboxDataUrl) {
    globalGrayboxFile = join(directory, 'global_graybox.png');
    await writeFile(globalGrayboxFile, dataUrlToBuffer(params.globalGrayboxDataUrl));
  }

  const shotFrameFiles: Record<string, string> = {};
  for (const shot of params.project.shots) {
    const dataUrl = params.shotFrameDataUrls?.[shot.id];
    if (!dataUrl) continue;
    const framePath = join(shotsDir, `${shot.shotNumber}_${slugifyName(shot.name)}.png`);
    await writeFile(framePath, dataUrlToBuffer(dataUrl));
    shotFrameFiles[shot.id] = framePath;
  }

  const manifest: StoryboardManifest = {
    name: params.project.name,
    sourceBrief: params.sourceBrief?.trim() || params.project.description,
    projectFile,
    globalGrayboxPath: globalGrayboxFile,
    beats: params.project.shots.map((shot, index) => ({
      order: index + 1,
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      name: shot.name,
      description: shot.description,
      framePath: shotFrameFiles[shot.id],
    })),
    createdAt: new Date().toISOString(),
  };

  const manifestFile = join(directory, 'storyboard.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    directory,
    projectFile,
    manifestFile,
    globalGrayboxFile,
    shotFrameFiles,
  };
}