import { type OpenClawRunner } from "./installer.js";
export type UpdateHelperArgs = {
    stateDir: string;
    tarballPath: string;
    version: string;
    directiveId: string;
};
type UpdateHelperDependencies = {
    runOpenClaw?: OpenClawRunner;
    now?: () => number;
};
export declare function resolveUpdateLockPath(stateDir: string): string;
export declare function runUpdateHelper(args: UpdateHelperArgs, dependencies?: UpdateHelperDependencies): Promise<"succeeded" | "failed">;
export declare function parseUpdateHelperArgs(argv: string[]): UpdateHelperArgs;
export {};
