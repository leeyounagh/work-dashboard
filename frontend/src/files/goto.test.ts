import { describe, expect, it } from 'vitest';
import { gotoTarget, importsIn } from './goto';

const src = `import React, { useState } from 'react';
import { NeoTitle } from '@repo/ui/titles';
import type { Props as TitleProps } from "./types";
import * as utils from '../utils';
import {
  NeoButton,
  NeoInput as Input,
} from '@repo/ui/buttons';
export { Thing as Other } from './thing';
const lazy = import('./Lazy');

const x = useState(0);
export function Page(p: TitleProps) {
  return <NeoTitle title={utils.format(x)} />;
}
`;

const at = (needle: string, nth = 0, offset = 1) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = src.indexOf(needle, i + 1);
  return i + offset;
};

describe('importsIn', () => {
  it('maps local names to their module and exported name', () => {
    const m = importsIn(src);
    expect(m.get('React')).toEqual({ spec: 'react', name: 'default' });
    expect(m.get('useState')).toEqual({ spec: 'react', name: 'useState' });
    expect(m.get('TitleProps')).toEqual({ spec: './types', name: 'Props' });
    expect(m.get('utils')).toEqual({ spec: '../utils', name: '*' });
    expect(m.get('NeoButton')).toEqual({ spec: '@repo/ui/buttons', name: 'NeoButton' });
    expect(m.get('Input')).toEqual({ spec: '@repo/ui/buttons', name: 'NeoInput' });
  });
});

describe('gotoTarget', () => {
  it('follows a module path to the file', () => {
    expect(gotoTarget(src, at("'@repo/ui/titles'", 0, 3))).toEqual({ spec: '@repo/ui/titles', name: '' });
    expect(gotoTarget(src, at("'./Lazy'", 0, 2))).toEqual({ spec: './Lazy', name: '' });
  });

  it('follows an imported name, where it is imported or used', () => {
    expect(gotoTarget(src, at('NeoTitle'))).toEqual({ spec: '@repo/ui/titles', name: 'NeoTitle' });
    expect(gotoTarget(src, at('NeoTitle', 1))).toEqual({ spec: '@repo/ui/titles', name: 'NeoTitle' });
    expect(gotoTarget(src, at('Input', 1))).toEqual({ spec: '@repo/ui/buttons', name: 'NeoInput' });
    expect(gotoTarget(src, at('TitleProps', 1))).toEqual({ spec: './types', name: 'Props' });
  });

  it('follows names in a re-export into its module', () => {
    expect(gotoTarget(src, at('Thing'))).toEqual({ spec: './thing', name: 'Thing' });
    expect(gotoTarget(src, at('Other'))).toEqual({ spec: './thing', name: 'Thing' });
  });

  it('looks up other names in the file, and skips keywords and properties', () => {
    expect(gotoTarget(src, at('x)'))).toEqual({ spec: '', name: 'x' });
    expect(gotoTarget(src, at('const x'))).toBeNull();
    expect(gotoTarget(src, at('format'))).toBeNull();
    expect(gotoTarget(src, at('(0)', 0, 1))).toBeNull();
  });
});
