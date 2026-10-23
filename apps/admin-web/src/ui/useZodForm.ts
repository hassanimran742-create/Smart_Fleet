import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { toMessageParams } from '@smartfleet/shared-utils';
import { parseRequest, type FieldIssue } from '@smartfleet/shared-validation';
import { fieldMessages, messageFor, toApiError } from '../api/errors';
import { translateDynamic } from '../i18n';

/** Any schema `parseRequest` accepts (the shared zod schemas of @smartfleet/shared-validation). */
type AnySchema = Parameters<typeof parseRequest>[0];
/** What the form edits: the schema's input. */
export type FormInput<S extends AnySchema> = S['_input'];
/** What a valid form produces: the schema's output (amounts become paisa digit strings, and so on). */
export type FormOutput<S extends AnySchema> = Extract<ReturnType<typeof parseRequest<S>>, { success: true }>['data'];
/** The values while editing: every top-level field may still be empty. */
export type FormValues<S extends AnySchema> = { [K in keyof FormInput<S>]?: FormInput<S>[K] };

export interface ZodForm<S extends AnySchema> {
  values: FormValues<S>;
  /** Translated messages by dotted path ("store.lat"), only for touched fields (or all after a submit). */
  errors: Readonly<Record<string, string>>;
  /** A message for the whole form: a server error that belongs to no field. */
  formError: string | null;
  setValue: <K extends keyof FormInput<S> & string>(name: K, value: FormInput<S>[K] | undefined) => void;
  /** Wire to a field's onBlur: validates and shows that field's error. */
  touch: (name: string) => void;
  /** The error to pass to `<Field error>`. */
  errorFor: (name: string) => string | undefined;
  /** `onSubmit` for the `<form>`: validates everything, then calls `onValid` with the parsed output. */
  handleSubmit: (onValid: (data: FormOutput<S>) => void | Promise<void>) => (event?: FormEvent) => void;
  /**
   * Shows an API error: `details.fields` under their fields, codes listed in `codeFields` under that field
   * (`{ TOPUP_BANK_REFERENCE_USED: 'bankReference' }`), anything else as `formError`.
   */
  setServerError: (error: unknown, codeFields?: Readonly<Record<string, string>>) => void;
  reset: (values?: FormValues<S>) => void;
  isDirty: boolean;
}

function issueMessage(issue: FieldIssue): string {
  return translateDynamic(`validation:${issue.code}`, toMessageParams(issue.params)) ?? issue.code;
}

function issuesByPath(issues: readonly FieldIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) if (!(issue.path in out)) out[issue.path] = issueMessage(issue);
  return out;
}

function belongsTo(path: string, name: string): boolean {
  return path === name || path.startsWith(`${name}.`);
}

/**
 * A small form hook over the shared zod schemas (UX_ADMIN §1.5): validates on blur and on submit,
 * shows messages from `validation:<CODE>`, and places server field errors with `setServerError`.
 */
export function useZodForm<S extends AnySchema>(schema: S, initial: FormValues<S>): ZodForm<S> {
  const initialRef = useRef(initial);
  const [values, setValues] = useState<FormValues<S>>(initial);
  /** The latest values, so `setValue` can tell an unchanged value without waiting for a render. */
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const clientErrors = useMemo(() => {
    const result = parseRequest(schema, values);
    return result.success ? {} : issuesByPath(result.fields);
  }, [schema, values]);

  const errors = useMemo(() => {
    const visible: Record<string, string> = {};
    for (const [path, message] of Object.entries(clientErrors)) {
      if (submitted || [...touched].some((name) => belongsTo(path, name))) visible[path] = message;
    }
    return { ...visible, ...serverErrors };
  }, [clientErrors, serverErrors, submitted, touched]);

  const setValue = useCallback(<K extends keyof FormInput<S> & string>(name: K, value: FormInput<S>[K] | undefined) => {
    // A field that sends its value again unchanged (PhoneInput normalises on blur) keeps its server
    // error: "phone in use" or "wrong password" must not vanish when the person just leaves the box.
    if (Object.is(valuesRef.current[name], value)) return;
    valuesRef.current = { ...valuesRef.current, [name]: value };
    setValues((prev) => ({ ...prev, [name]: value }));
    setServerErrors((prev) => {
      const next = { ...prev };
      for (const path of Object.keys(next)) if (belongsTo(path, name)) delete next[path];
      return next;
    });
    setFormError(null);
  }, []);

  const touch = useCallback((name: string) => {
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

  const errorFor = useCallback(
    (name: string) => errors[name] ?? Object.entries(errors).find(([path]) => belongsTo(path, name))?.[1],
    [errors],
  );

  const handleSubmit = useCallback(
    (onValid: (data: FormOutput<S>) => void | Promise<void>) => (event?: FormEvent) => {
      event?.preventDefault();
      setSubmitted(true);
      const result = parseRequest(schema, values);
      if (!result.success) {
        const first = result.fields[0]?.path;
        if (first) {
          const target = document.querySelector<HTMLElement>(`[name="${CSS.escape(first.split('.')[0])}"]`);
          target?.focus();
        }
        return;
      }
      void onValid(result.data as FormOutput<S>);
    },
    [schema, values],
  );

  const setServerError = useCallback((error: unknown, codeFields: Readonly<Record<string, string>> = {}) => {
    const apiError = toApiError(error);
    const byField = fieldMessages(apiError);
    const mapped = codeFields[apiError.code];
    if (mapped) byField[mapped] = messageFor(apiError);
    setServerErrors(byField);
    // A code mapped to a field is shown there only. Anything else is also said at the top, so a
    // problem with a field the form doesn't show is never invisible ("Some details need fixing.").
    setFormError(mapped ? null : messageFor(apiError));
  }, []);

  const reset = useCallback((next?: FormValues<S>) => {
    const base = next ?? initialRef.current;
    initialRef.current = base;
    valuesRef.current = base;
    setValues(base);
    setTouched(new Set());
    setSubmitted(false);
    setServerErrors({});
    setFormError(null);
  }, []);

  const isDirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initialRef.current), [values]);

  return { values, errors, formError, setValue, touch, errorFor, handleSubmit, setServerError, reset, isDirty };
}
