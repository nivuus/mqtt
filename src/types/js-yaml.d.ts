// src/types/js-yaml.d.ts
declare module 'js-yaml' {
  export function load(str: string, opts?: any): any;
  // Add other functions from js-yaml if used, e.g., dump
  // export function dump(obj: any, opts?: any): string;
}
