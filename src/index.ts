// Punto de entrada principal para scanner-kit-playwright
export { ScannerKit } from './scanner-kit';

// Re-export de módulos individuales para uso granular
export { TurboManager, TurboOptions } from './modules/turbo-manager';
export { EvasionManager, EvasionOptions } from './modules/evasion-manager';
export { FrameExplorer, FindFrameOptions } from './modules/frame-explorer';
export { ApiSpy } from './modules/api-spy';
export { SessionManager } from './modules/session-manager';
export { ReconEngine } from './modules/recon-engine';
export { TelemetryExtractor } from './modules/telemetry-extractor';
export { SessionRefresher } from './modules/session-refresher';
export { FormAnalyzer } from './modules/form-analyzer';
export { AgentBriefing, AgentBriefingInput } from './modules/agent-briefing';
export { BrandExtractor, BrandExtractorOptions } from './modules/brand-extractor';
export { StaticSurfaceMiner } from './modules/static-surface-miner';

// Re-export de tipos e interfaces TypeScript
export * from './types';
