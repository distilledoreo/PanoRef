import { parseProject } from '../engine/projectIO';
import { renderGrayboxEquirectangularPano, renderShotFrame } from '../engine/renderers';

export interface RenderBridgeGrayboxResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface RenderBridgeShotFrameResult {
  shotId: string;
  shotNumber: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ContinuityRenderBridge {
  ready: boolean;
  renderGraybox: (projectJson: string) => Promise<RenderBridgeGrayboxResult>;
  renderShotFrames: (
    projectJson: string,
    shotIds?: string[],
  ) => Promise<RenderBridgeShotFrameResult[]>;
}

declare global {
  interface Window {
    __continuityRenderBridge?: ContinuityRenderBridge;
  }
}

async function bootRenderBridge() {
  const bridge: ContinuityRenderBridge = {
    ready: false,
    async renderGraybox(projectJson) {
      const project = parseProject(projectJson);
      const render = await renderGrayboxEquirectangularPano(project);
      return {
        dataUrl: render.dataUrl,
        width: render.width,
        height: render.height,
      };
    },
    async renderShotFrames(projectJson, shotIds) {
      const project = parseProject(projectJson);
      const targets = shotIds?.length
        ? project.shots.filter((shot) => shotIds.includes(shot.id))
        : project.shots;

      const frames: RenderBridgeShotFrameResult[] = [];
      for (const shot of targets) {
        const render = await renderShotFrame(project, shot);
        frames.push({
          shotId: shot.id,
          shotNumber: shot.shotNumber,
          dataUrl: render.dataUrl,
          width: render.width,
          height: render.height,
        });
      }
      return frames;
    },
  };

  bridge.ready = true;
  window.__continuityRenderBridge = bridge;
}

void bootRenderBridge();