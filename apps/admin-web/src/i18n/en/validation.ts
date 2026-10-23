import { VALIDATION_MESSAGE_EN, type ValidationCode } from '@smartfleet/shared-validation';

/**
 * `validation`: field messages (`validation:<CODE>`), owned by the foundation lane.
 *
 * The English resource IS `VALIDATION_MESSAGE_EN` from @smartfleet/shared-validation: every zod issue in
 * the shared schemas, and every `details.fields[].code` the API returns, carries one of these codes.
 * `{{min}}`/`{{max}}` come from the issue's params; a `*Paisa` param is formatted with `formatRs`.
 */
export const validation: Readonly<Record<ValidationCode, string>> = VALIDATION_MESSAGE_EN;
