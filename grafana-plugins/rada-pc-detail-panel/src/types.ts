// Composite PC-detail panel options.
// v1: demo-first (faithful design preview). Real-data wiring is the next pass
// (multiple query targets → pc shape). demoPc picks which demo state to render.

export interface PCDetailOptions {
  demoMode: boolean;     // render embedded demo data (design preview)
  demoPc: string;        // 'PC-07' (위험) | 'PC-12' (정상)
}

export const defaultOptions: PCDetailOptions = {
  demoMode: true,
  demoPc: 'PC-07',
};
