import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx, TextInput } from '../../ui';
import { useDistributors } from '../distributors/api';
import { readCylinderNumber } from './code';
import './cylinders.css';

export interface FindCylinderBoxProps {
  /** `nav`: the box at the top of the menu, on the menu's dark ground; `page`: in a page header. */
  tone?: 'nav' | 'page';
  /** After a search: the menu sheet under 1024 px closes. */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Find cylinder (UX_ADMIN §3.5, website spec "Forward rules"): one search box with the placeholder "Find
 * cylinder". Enter (or a USB scanner, which types and presses Enter) opens `/cylinders/find/$number`.
 * "ag-c42" is written out as AG-C0042; a bare 42 is read with the distributor's code while there is only
 * one distributor (with more, the page asks for the full number); a scanned QR value goes as it is.
 */
export function FindCylinderBox({ tone = 'page', onNavigate, className }: FindCylinderBoxProps) {
  const { t } = useTranslation('cylinders');
  const navigate = useNavigate();
  const distributors = useDistributors();
  const [text, setText] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const only = distributors.data?.length === 1 ? (distributors.data[0]?.code ?? null) : null;
    const { code } = readCylinderNumber(value, only);
    setText('');
    void navigate({ to: '/cylinders/find/$number', params: { number: code } });
    onNavigate?.();
  };

  return (
    <form role="search" className={cx('sf-find', `sf-find--${tone}`, className)} onSubmit={submit}>
      <TextInput
        type="search"
        value={text}
        placeholder={t('find.placeholder')}
        aria-label={t('find.placeholder')}
        autoComplete="off"
        spellCheck={false}
        startAdornment={<Search aria-hidden size={16} />}
        onChange={(event) => setText(event.target.value)}
      />
    </form>
  );
}
