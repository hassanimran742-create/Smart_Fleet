import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import type { legacy } from '../i18n/en/legacy';

/**
 * The `legacy` namespace (i18n/en/legacy.ts, website spec §3 J): the words of the legacy screens'
 * light pass, registered with the others in i18n/index.ts. `lt('drivers.add')` is checked against the
 * English resource at compile time, so a missing key fails `tsc`, as `t()` does for the other
 * namespaces.
 */

/** Every key path of the copy ("drivers.columns.van"). */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A counted key is used without its plural suffix: "drivers.count_one" is called as "drivers.count". */
type WithoutPlural<K extends string> = K extends `${infer B}_one` ? B : K extends `${infer B}_other` ? B : K;

export type LegacyKey = WithoutPlural<Paths<typeof legacy>>;
export type LegacyT = (key: LegacyKey, params?: Record<string, unknown>) => string;

type LooseT = (key: string, options?: Record<string, unknown>) => string;

/** The translator of the legacy screens; it re-renders on a language change, like `useTranslation`. */
export function useLegacyT(): LegacyT {
  const { i18n: instance } = useTranslation();
  return useCallback<LegacyT>(
    (key, params) => (instance.t as unknown as LooseT)(`legacy:${key}`, params),
    // `language` changes when the language does, so the function (and its users) update.
    [instance, instance.language],
  );
}

/** The same words outside React (a confirm built in an event handler). */
export const lt: LegacyT = (key, params) => (i18n.t as unknown as LooseT)(`legacy:${key}`, params);

/** A cylinder size in the website's words, "11.8 kg", from its weight; else its name (as the API does). */
export function sizeLabelOf(type: { name: string; weightKg?: string | number | null }): string {
  const kg = Number(type.weightKg);
  return Number.isFinite(kg) && kg > 0 ? `${kg} kg` : type.name;
}
