import type { SettingSpec } from '../lib/widgets';

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Value → text for an input. */
export function formatSetting(spec: SettingSpec, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (spec.kind === 'stringList') return Array.isArray(value) ? value.join(', ') : '';
  return String(value);
}

/** Input → setting value, validated like the Go side so saving cannot fail. */
export function parseSetting(spec: SettingSpec, input: string | boolean): ParseResult {
  switch (spec.kind) {
    case 'bool':
      return { ok: true, value: Boolean(input) };
    case 'int': {
      const text = String(input).trim();
      if (!/^-?\d+$/.test(text)) return { ok: false, error: `${spec.label}: 정수를 입력하세요` };
      const n = Number(text);
      if (n < spec.min || n > spec.max) return { ok: false, error: `${spec.label}: ${spec.min}~${spec.max} 사이여야 합니다` };
      return { ok: true, value: n };
    }
    case 'enum': {
      const v = String(input);
      if (!spec.options?.includes(v)) return { ok: false, error: `${spec.label}: 선택지에 없는 값입니다` };
      return { ok: true, value: v };
    }
    case 'stringList':
      return {
        ok: true,
        value: String(input)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    default:
      return { ok: true, value: String(input).trim() };
  }
}
