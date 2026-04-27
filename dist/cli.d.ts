import type { CLIOptions, CombinedHandlers, Handlers, Router, RunConfig, Schema } from './types';
export declare class CLI<TSchema extends Router, TGlobals extends Schema = Schema, TContext = undefined> {
    Handlers: CombinedHandlers<Handlers<TSchema, Awaited<TContext>>>;
    private schema;
    private options;
    constructor(schema: TSchema, options: CLIOptions<TGlobals, TContext>);
    run(runOptions: RunConfig<TSchema, Awaited<TContext>>, argv?: string[]): Promise<void>;
    private resolveRouter;
    private extractCommand;
    private getAvailableCommands;
    private buildInput;
    private extractInputFlag;
    private assertJsonInputUsage;
    private getGlobalOptionNames;
    private parseJsonInput;
    private readInputString;
    private findByAlias;
    private createHookDispatcher;
}
export declare function cli<TSchema extends Router, TGlobals extends Schema = Schema, TContext = undefined>(schema: TSchema, options: CLIOptions<TGlobals, TContext>): CLI<TSchema, TGlobals, TContext>;
