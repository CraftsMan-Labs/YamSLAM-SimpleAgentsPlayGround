export type ExampleConfigLike = {
  code: string;
  yaml?: string;
};

export type PlaygroundDraftWorkspace = {
  id: string;
  title: string;
  yaml: string;
  code: string;
  updatedAt: number;
};

export type PlaygroundDraftStore = {
  version: 1;
  lastWorkspaceId: string;
  workspaces: Record<string, PlaygroundDraftWorkspace>;
};

export const PLAYGROUND_DRAFT_STORAGE_KEY = "yamslam.playground.drafts.v1";

export function createWorkspaceDraft(input: {
  id: string;
  title: string;
  yaml: string;
  code: string;
}): PlaygroundDraftWorkspace {
  return {
    id: input.id,
    title: input.title,
    yaml: input.yaml,
    code: input.code,
    updatedAt: Date.now()
  };
}

export function createDraftStore(input: {
  id: string;
  title: string;
  yaml: string;
  code: string;
}): PlaygroundDraftStore {
  const workspace = createWorkspaceDraft(input);
  return {
    version: 1,
    lastWorkspaceId: workspace.id,
    workspaces: {
      [workspace.id]: workspace
    }
  };
}

export function createDraftFromExample(id: string, example: ExampleConfigLike, yamlOverride?: string) {
  return createWorkspaceDraft({
    id,
    title: id,
    yaml: yamlOverride ?? example.yaml ?? "",
    code: example.code
  });
}

export function readDraftStore(raw: string | null): PlaygroundDraftStore | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlaygroundDraftStore>;
    if (
      parsed.version !== 1 ||
      typeof parsed.lastWorkspaceId !== "string" ||
      parsed.workspaces === null ||
      typeof parsed.workspaces !== "object"
    ) {
      return null;
    }

    const workspaces = Object.fromEntries(
      Object.entries(parsed.workspaces).filter((entry): entry is [string, PlaygroundDraftWorkspace] => {
        const [id, workspace] = entry;
        return (
          typeof id === "string" &&
          workspace !== null &&
          typeof workspace === "object" &&
          typeof workspace.id === "string" &&
          typeof workspace.title === "string" &&
          typeof workspace.yaml === "string" &&
          typeof workspace.code === "string" &&
          typeof workspace.updatedAt === "number"
        );
      })
    );

    if (Object.keys(workspaces).length === 0) {
      return null;
    }

    if (!(parsed.lastWorkspaceId in workspaces)) {
      const [firstWorkspaceId] = Object.keys(workspaces);
      return {
        version: 1,
        lastWorkspaceId: firstWorkspaceId,
        workspaces
      };
    }

    return {
      version: 1,
      lastWorkspaceId: parsed.lastWorkspaceId,
      workspaces
    };
  } catch {
    return null;
  }
}
