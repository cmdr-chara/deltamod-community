// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
export {};

type LocalizedAttribute = 'title' | 'aria-label' | 'aria-valuetext' | 'placeholder' | 'alt';

declare global {
  interface Window {
    Localization?: {
      ready: Promise<unknown>;
      t(key: string, fallback?: string, ...args: unknown[]): string;
      text(source: string, ...args: unknown[]): string;
      bind<T extends Element>(element: T, key: string, fallback?: string, ...args: unknown[]): T;
      bindText<T extends Element>(element: T, source: string, ...args: unknown[]): T;
      bindAttribute<T extends Element>(element: T, attribute: LocalizedAttribute, key: string, fallback?: string, ...args: unknown[]): T;
      bindTextAttribute<T extends Element>(element: T, attribute: LocalizedAttribute, source: string, ...args: unknown[]): T;
      bindComputed<T extends Element>(element: T, render: () => string, attribute?: LocalizedAttribute | 'textContent'): T;
      release(root: Node): void;
      apply(root?: Element | Document): void;
      applyKnownText(root?: Element | Document): void;
      replaceTokens(html: string): string;
      translateKnownText(value: string): string;
      number(value: number, options?: Intl.NumberFormatOptions): string;
      date(value: number | string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string;
      relativeTime(value: number | Date, now?: number): string;
      plural(key: string, count: number, fallback?: string, ...args: unknown[]): string;
      getLanguage(): string;
      getLocale(): string;
      bidi(value: unknown): string;
      setLanguage(code: string, options?: { refreshPage?: boolean }): Promise<string>;
      getLanguages(): Promise<Array<{ code: string; name: string; author: string; version: string; flag: string }>>;
      normalizeLanguage(value: unknown): string | null;
      detectLanguage(values: unknown[]): string;
      supportedLanguages: readonly string[];
    };
  }
}
