export interface ReleaseFilesOptions {
  outputDir: string;
  packagePath: string;
  tag: string | undefined;
  commit: string | undefined;
}

export interface ReleaseManifest {
  name: string;
  version: string;
  tag: string;
  commit: string | null;
  packageFile: string;
  sha256: string;
}

export function createReleaseFiles(options: ReleaseFilesOptions): Promise<ReleaseManifest>;
