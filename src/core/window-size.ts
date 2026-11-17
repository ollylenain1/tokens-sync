import { record } from './model';

export interface WindowSize {
  width: number;
  height: number;
}
export const defaultWindowSize: WindowSize = { width: 440, height: 720 };
export function windowSize(value: unknown): WindowSize | undefined {
  if (!record(value) || typeof value.width !== 'number' || typeof value.height !== 'number')
    return undefined;
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return undefined;
  return {
    width: Math.round(Math.max(360, Math.min(1200, value.width))),
    height: Math.round(Math.max(400, Math.min(1000, value.height))),
  };
}
export function savedWindowSize(value: unknown): WindowSize {
  return (
    windowSize(value) ?? (value === 'wide' ? { width: 620, height: 720 } : { ...defaultWindowSize })
  );
}
