import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, ScanLine, X } from 'lucide-react';
import type { ErrorDetails, OrderDto } from '@smartfleet/shared-types';
import type { ManualDeliveryV2Input } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError } from '../../api/errors';
import { resources } from '../../i18n';
import {
  AddMore,
  Button,
  Chip,
  cx,
  Field,
  FilterChips,
  flashRow,
  IconButton,
  InlineAlert,
  Modal,
  RadioCards,
  Spinner,
  Textarea,
  TextInput,
  useToast,
} from '../../ui';
import { fetchCylinderHistory } from '../cylinders/api';
import { readCylinderNumber } from '../cylinders/code';
import { useInvalidateOrder, useManualDelivery } from './api';
import {
  checkDelivered,
  checkTakenBack,
  MANUAL_RETURN_STATES,
  markListedTwice,
  orderDistributorCode,
  serverProblem,
  sizeProgress,
  withCountProblems,
  type ChipProblem,
  type ManualReturnState,
  type NamedCylinder,
} from './manual';

/** The reasons a manual delivery can give; their English words are what is sent (each 10+ characters). */
const REASONS = ['NOT_SCANNED', 'PHONE', 'OTHER'] as const;
type ReasonCode = (typeof REASONS)[number];

/** The reason note for Other: 10–300 characters (the API's `reason`). */
const NOTE_MIN = 10;
const NOTE_MAX = 300;

type ListId = 'delivered' | 'takenBack';

/** A chip's words after "·": its size or state when it can be used, else what is wrong with it. */
function useChipDetail() {
  const { t } = useTranslation('orders');
  const problemWords = (problem: ChipProblem): string => {
    const { kind } = problem;
    if (kind === 'WRONG_SIZE') return t('manual.problem.WRONG_SIZE', { size: problem.size ?? '' });
    return t(`manual.problem.${kind}`);
  };
  return (chip: NamedCylinder, list: ListId): string | null => {
    if (chip.status === 'problem' && chip.problem) return problemWords(chip.problem);
    if (chip.status !== 'ok') return null;
    if (list === 'takenBack' && chip.returnState) return t(`manual.state.${chip.returnState}`);
    return chip.size?.label ?? null;
  };
}

interface ChipListProps {
  list: ListId;
  chips: readonly NamedCylinder[];
  onRemove: (chip: NamedCylinder) => void;
}

/**
 * The named cylinders as chips (Inc 2/3 spec §3.3): "AG-C0001 · 11.8 kg" with a green tick, or
 * "AG-C0014 · with another customer" with a red mark, each with a remove button. The list is a polite
 * live region, so a screen reader hears each check land.
 */
function ChipList({ list, chips, onRemove }: ChipListProps) {
  const { t } = useTranslation('orders');
  const detail = useChipDetail();
  if (chips.length === 0) return null;
  return (
    <ul className="sf-manual__chips" aria-live="polite">
      {chips.map((chip) => {
        const words = detail(chip, list);
        const text = words ? t('manual.chip', { code: chip.label, detail: words }) : chip.label;
        return (
          <li key={chip.key} className="sf-manual__chip">
            {chip.status === 'checking' ? (
              <span className="sf-chip sf-chip--neutral">
                <Spinner size={12} label={t('manual.checking', { code: chip.label })} />
                <span className="sf-chip__label">{text}</span>
              </span>
            ) : (
              <Chip tone={chip.status === 'ok' ? 'success' : 'danger'} icon={chip.status === 'ok' ? CircleCheck : CircleAlert}>
                {text}
              </Chip>
            )}
            <IconButton icon={X} size="sm" label={t('manual.remove', { code: chip.label })} onClick={() => onRemove(chip)} />
          </li>
        );
      })}
    </ul>
  );
}

interface NumberBoxProps {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  inputRef: RefObject<HTMLInputElement>;
  disabled: boolean;
}

/** "Cylinder number" with Add: Enter adds too, so a USB scanner (it types the number and Enter) just works. */
function NumberBox({ value, onChange, onAdd, inputRef, disabled }: NumberBoxProps) {
  const { t } = useTranslation('orders');
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onAdd();
  };
  return (
    <Field label={t('manual.number')}>
      <div className="sf-manual__number">
        <TextInput
          ref={inputRef}
          mono
          value={value}
          placeholder={t('manual.numberPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          startAdornment={<ScanLine aria-hidden size={16} />}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button onClick={onAdd} disabled={disabled}>
          {t('manual.add')}
        </Button>
      </div>
    </Field>
  );
}

/**
 * Mark delivered by the office, naming each cylinder (UX_ADMIN §3.4, Inc 2/3 spec §3.3, website spec
 * W32): the forgotten-IN path, behind the drawer's footer button "Mark delivered…". Every delivered
 * cylinder is named by number, with the order's sizes counting down; taken-back cylinders wait behind
 * "+ Add taken back". The reason is a tap; only Other asks for words. **No money moves.**
 *
 * Each number is written out in full with the order's distributor code (1 → AG-C0001) and checked as it
 * is added (`GET /cylinders/:code/history`); the server checks everything again and refuses the whole
 * request on any problem, which turns those chips red. The main button stays enabled and points at what
 * is missing: the "Still needed" line turns red and the focus goes to the number box, or "Pick a
 * reason." shows. Nothing is sent until every size is named and a reason is picked. A repeat
 * (`X-Already-Applied`) shows the same toast; the drawer stays open on the delivered order.
 */
export function ManualDeliveryDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { t } = useTranslation(['orders', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const deliver = useManualDelivery(order.id);
  const invalidate = useInvalidateOrder(order.id);
  const distributorCode = useMemo(() => orderDistributorCode(order), [order]);

  const deliveredInput = useRef<HTMLInputElement>(null);
  const takenInput = useRef<HTMLInputElement>(null);
  const reasonsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [delivered, setDelivered] = useState<NamedCylinder[]>([]);
  const [takenBack, setTakenBack] = useState<NamedCylinder[]>([]);
  const [deliveredText, setDeliveredText] = useState('');
  const [takenText, setTakenText] = useState('');
  const [nextState, setNextState] = useState<ManualReturnState>('EMPTY');
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [pressed, setPressed] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const busy = deliver.isPending;

  // What the chips say once every rule is applied: one cylinder named twice, then the counts per size.
  const [deliveredOnce, takenBackView] = useMemo(() => markListedTwice(delivered, takenBack), [delivered, takenBack]);
  const deliveredView = useMemo(() => withCountProblems(deliveredOnce, order), [deliveredOnce, order]);
  const progress = useMemo(() => sizeProgress(deliveredOnce, order), [deliveredOnce, order]);
  const missing = progress.filter((size) => size.named < size.needed);
  const stillNeeded = missing.map((size) => t('format.cylinderLine', { n: size.needed - size.named, size: size.sizeLabel })).join(', ');

  const setList = (list: ListId) => (list === 'delivered' ? setDelivered : setTakenBack);
  const update = (list: ListId, key: string, patch: Partial<NamedCylinder>) =>
    setList(list)((chips) => chips.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip)));

  /** Looks the number up, then marks its chip usable or says what is wrong with it. */
  const check = async (list: ListId, chip: NamedCylinder) => {
    try {
      const history = await fetchCylinderHistory(queryClient, chip.code);
      const problem =
        list === 'delivered' ? checkDelivered(history, order, distributorCode) : checkTakenBack(history, order, distributorCode);
      update(list, chip.key, {
        status: problem ? 'problem' : 'ok',
        problem,
        cylinderId: history.cylinder.id,
        size: history.cylinder.size,
        label: history.cylinder.shortCode ?? chip.label,
      });
    } catch (error) {
      update(list, chip.key, { status: 'problem', problem: { kind: toApiError(error).is('NOT_FOUND') ? 'UNKNOWN' : 'NOT_CHECKED' } });
    }
  };

  const add = (list: ListId) => {
    const text = list === 'delivered' ? deliveredText : takenText;
    const input = list === 'delivered' ? deliveredInput : takenInput;
    input.current?.focus();
    if (!text.trim() || busy) return;
    const typed = readCylinderNumber(text, distributorCode);
    const key = typed.code.toUpperCase();
    (list === 'delivered' ? setDeliveredText : setTakenText)('');
    setAlert(null);
    // Named already (in either list): the chip is there; one cylinder can't be both given and taken back.
    if ([...delivered, ...takenBack].some((chip) => chip.key === key)) return;
    const otherShop = typed.written !== null && distributorCode !== null && typed.written !== distributorCode;
    const chip: NamedCylinder = {
      key,
      code: typed.code,
      label: typed.code,
      status: otherShop ? 'problem' : 'checking',
      size: null,
      problem: otherShop ? { kind: 'WRONG_OWNER' } : null,
      returnState: list === 'takenBack' ? nextState : undefined,
    };
    setList(list)((chips) => [...chips, chip]);
    if (!otherShop) void check(list, chip);
  };

  const remove = (list: ListId, chip: NamedCylinder) => {
    setList(list)((chips) => chips.filter((item) => item.key !== chip.key));
    setAlert(null);
    (list === 'delivered' ? deliveredInput : takenInput).current?.focus();
  };

  /** Marks the chips the server refused, by the code that was sent. */
  const markRefused = (details: ErrorDetails<'MANUAL_DELIVERY_CYLINDERS_MISMATCH'>) => {
    const byCode = new Map(details.problems.map((problem) => [problem.code.toUpperCase(), problem]));
    const mark = (chips: NamedCylinder[]) =>
      chips.map((chip) => {
        const problem = byCode.get(chip.code.toUpperCase());
        return problem ? { ...chip, status: 'problem' as const, problem: serverProblem(problem, chip.size?.label) } : chip;
      });
    setDelivered(mark);
    setTakenBack(mark);
  };

  const confirm = () => {
    if (busy) return;
    const unusable = [...deliveredView, ...takenBackView].some((chip) => chip.status === 'problem');
    const checking = [...delivered, ...takenBack].some((chip) => chip.status === 'checking');
    const noteShort = reason === 'OTHER' && note.trim().length < NOTE_MIN;
    if (unusable) setAlert(t('manual.mismatch'));
    if (missing.length > 0 || unusable || checking || reason === null || noteShort) {
      setPressed(true);
      if (missing.length > 0 || unusable || checking) deliveredInput.current?.focus();
      else if (reason === null) reasonsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
      else noteRef.current?.focus();
      return;
    }
    // The picked option's English words are the reason (UX_ADMIN §3.4), or the Other note.
    const words = reason === 'OTHER' ? note.trim() : resources.en.orders.manual.reasons[reason];
    const body: ManualDeliveryV2Input = {
      reason: words,
      cylinders: delivered.map((chip) => ({ code: chip.code })),
      takenBack:
        takenBack.length > 0 ? takenBack.map((chip) => ({ code: chip.code, returnState: chip.returnState ?? 'EMPTY' })) : undefined,
    };
    setAlert(null);
    deliver.mutate(body, {
      onSuccess: (updated) => {
        toast.success(t('manual.toast', { no: updated.shortCode ?? order.shortCode }));
        flashRow('orders', order.id);
        void invalidate();
        onClose();
      },
      onError: (failure) => {
        const mismatch = errorDetails(failure, 'MANUAL_DELIVERY_CYLINDERS_MISMATCH');
        if (mismatch) {
          markRefused(mismatch);
          setAlert(t('manual.mismatch'));
          return;
        }
        const unknown = errorDetails(failure, 'SCAN_CYLINDER_UNKNOWN');
        if (unknown?.code) {
          const key = unknown.code.toUpperCase();
          const mark = (chips: NamedCylinder[]) =>
            chips.map((chip) => (chip.code.toUpperCase() === key ? { ...chip, status: 'problem' as const, problem: { kind: 'UNKNOWN' as const } } : chip));
          setDelivered(mark);
          setTakenBack(mark);
          setAlert(t('manual.mismatch'));
          return;
        }
        if (failure.is('ORDER_INVALID_TRANSITION', 'NOT_FOUND')) {
          // The order moved on meanwhile (the driver delivered it, or it was cancelled): show it as it is now.
          toast.error(failure);
          void invalidate();
          onClose();
          return;
        }
        setAlert(messageFor(failure));
      },
    });
  };

  const reasonOptions = REASONS.map((code) => ({ value: code, label: t(`manual.reasons.${code}`) }));

  return (
    <Modal
      open
      size="lg"
      role="alertdialog"
      title={t('manual.title', { no: order.shortCode })}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      className="sf-manual"
      footer={
        <>
          {missing.length > 0 ? (
            <span className={cx('sf-manual__still', pressed && 'is-error')} aria-live="polite">
              {t('manual.stillNeeded', { list: stillNeeded })}
            </span>
          ) : null}
          <Button onClick={onClose} disabled={busy}>
            {t('common:actions.goBack')}
          </Button>
          <Button variant="primary" loading={busy} onClick={confirm}>
            {t('manual.confirm')}
          </Button>
        </>
      }
    >
      <div className="sf-manual__body">
        <p className="sf-order-dialog__body">{t('manual.body')}</p>
        {alert ? (
          <InlineAlert tone="danger" live>
            {alert}
          </InlineAlert>
        ) : null}

        <section className="sf-manual__section" aria-labelledby="manual-delivered">
          <h3 id="manual-delivered" className="sf-manual__heading">
            {t('manual.delivered')}
          </h3>
          <div className="sf-manual__progress">
            {progress.map((size) => (
              <Chip
                key={size.cylinderTypeId}
                tone={size.named >= size.needed ? 'success' : 'neutral'}
                icon={size.named >= size.needed ? CircleCheck : undefined}
              >
                {t('manual.sizeProgress', { size: size.sizeLabel, done: size.named, total: size.needed })}
              </Chip>
            ))}
          </div>
          <NumberBox
            value={deliveredText}
            onChange={setDeliveredText}
            onAdd={() => add('delivered')}
            inputRef={deliveredInput}
            disabled={busy}
          />
          <ChipList list="delivered" chips={deliveredView} onRemove={(chip) => remove('delivered', chip)} />
        </section>

        <AddMore label={t('manual.addTakenBack')} defaultOpen={takenBack.length > 0}>
          <section className="sf-manual__section" aria-labelledby="manual-taken-back">
            <h3 id="manual-taken-back" className="sf-manual__heading">
              {t('manual.takenBack')}
            </h3>
            <FilterChips<ManualReturnState>
              label={t('manual.takenBackState')}
              options={MANUAL_RETURN_STATES.map((state) => ({ value: state, label: t(`manual.state.${state}`) }))}
              value={nextState}
              onChange={setNextState}
            />
            <NumberBox value={takenText} onChange={setTakenText} onAdd={() => add('takenBack')} inputRef={takenInput} disabled={busy} />
            <ChipList list="takenBack" chips={takenBackView} onRemove={(chip) => remove('takenBack', chip)} />
          </section>
        </AddMore>

        <Field label={t('manual.reason')} error={pressed && reason === null ? t('manual.pickReason') : null}>
          <div ref={reasonsRef}>
            <RadioCards options={reasonOptions} value={reason} onChange={setReason} />
          </div>
        </Field>
        {reason === 'OTHER' ? (
          <Field
            label={t('manual.otherNote')}
            error={pressed && note.trim().length < NOTE_MIN ? t('manual.needNote') : null}
          >
            <Textarea
              ref={noteRef}
              value={note}
              rows={2}
              maxLength={NOTE_MAX}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
