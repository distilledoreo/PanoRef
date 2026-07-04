import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocationProject } from '../src/domain/types';
import { parseProject, serializeProject } from '../src/engine/projectIO';
import { createId } from '../src/utils/ids';

export interface WorkspaceRecord {
  id: string;
  name: string;
  directory: string;
  projectFile: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceRegistry {
  activeWorkspaceId?: string;
  workspaces: WorkspaceRecord[];
}

function defaultWorkspaceRoot() {
  return process.env.CONTINUITY_WORKSPACE
    ?? join(homedir(), '.continuity-stage', 'workspaces');
}

export class WorkspaceManager {
  private root: string;
  private registryFile: string;
  private registry: WorkspaceRegistry = { workspaces: [] };

  constructor(root = defaultWorkspaceRoot()) {
    this.root = resolve(root);
    this.registryFile = join(this.root, 'registry.json');
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    try {
      const raw = await readFile(this.registryFile, 'utf8');
      this.registry = JSON.parse(raw) as WorkspaceRegistry;
    } catch {
      this.registry = { workspaces: [] };
      await this.saveRegistry();
    }
  }

  getRoot() {
    return this.root;
  }

  listWorkspaces() {
    return [...this.registry.workspaces];
  }

  getActiveWorkspaceId() {
    return this.registry.activeWorkspaceId;
  }

  getWorkspace(id?: string): WorkspaceRecord | undefined {
    const workspaceId = id ?? this.registry.activeWorkspaceId;
    if (!workspaceId) return undefined;
    return this.registry.workspaces.find((workspace) => workspace.id === workspaceId);
  }

  async createWorkspace(name: string): Promise<WorkspaceRecord> {
    const id = createId('ws');
    const directory = join(this.root, id);
    const projectFile = join(directory, 'project.json');
    const now = new Date().toISOString();

    await mkdir(directory, { recursive: true });

    const record: WorkspaceRecord = {
      id,
      name: name.trim() || 'Untitled Storyboard',
      directory,
      projectFile,
      createdAt: now,
      updatedAt: now,
    };

    this.registry.workspaces.unshift(record);
    this.registry.activeWorkspaceId = id;
    await this.saveRegistry();
    return record;
  }

  async setActiveWorkspace(id: string) {
    const workspace = this.getWorkspace(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    this.registry.activeWorkspaceId = id;
    await this.saveRegistry();
    return workspace;
  }

  async loadProject(workspaceId?: string): Promise<LocationProject> {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('No active workspace. Create one with continuity_create_storyboard first.');
    }

    const raw = await readFile(workspace.projectFile, 'utf8');
    return parseProject(raw);
  }

  async saveProject(project: LocationProject, workspaceId?: string): Promise<WorkspaceRecord> {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('No active workspace. Create one with continuity_create_storyboard first.');
    }

    await writeFile(workspace.projectFile, serializeProject(project), 'utf8');
    workspace.updatedAt = new Date().toISOString();
    workspace.name = project.name;
    await this.saveRegistry();
    return workspace;
  }

  async listStoryboardExports(workspaceId?: string) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) return [];

    const entries = await readdir(workspace.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'shots')
      .map((entry) => join(workspace.directory, entry.name));
  }

  private async saveRegistry() {
    await writeFile(this.registryFile, JSON.stringify(this.registry, null, 2), 'utf8');
  }
}