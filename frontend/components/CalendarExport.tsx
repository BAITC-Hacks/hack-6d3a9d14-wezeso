'use client';
import { useI18n } from '../lib/i18n';
import { localizeCalendarEntry } from '../lib/calendar-locale';

import { useState } from 'react';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { CalendarPlus, DownloadSimple, ArrowUpRight, X } from '@phosphor-icons/react';
import { Btn } from './UI';
import { calendarLinks, downloadCalendar, type CalendarEntry } from '../lib/calendar';
import styles from './CalendarPanel.module.css';

export default function CalendarExport({ entry }: { entry: CalendarEntry }) {
 const { t, date, number, languageTag, locale } = useI18n();
 const calendarDateLabel=(value:string, options?:Intl.DateTimeFormatOptions)=>date(value, options ?? {day:'numeric',month:'long',year:'numeric'});

  const [open, setOpen] = useState(false);
  const localized = localizeCalendarEntry(locale, entry);
  const links = calendarLinks(localized);
  return <>
    <Btn onClick={() => setOpen(true)}><CalendarPlus size={17}/>{t("В календарь")}</Btn>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog size="lg" className="modal">
        <div className="section-heading"><Dialog.Title>{t("Добавить в календарь")}</Dialog.Title><Btn variant="ghost" shape="square" onClick={() => setOpen(false)} aria-label={t("Закрыть")}><X size={20}/></Btn></div>
        <Dialog.Description className={styles.exportDescription}>{t(entry.title)} · {calendarDateLabel(entry.date)}  {t("· Весь день")}</Dialog.Description>
        <div className={styles.exportLinks}>
          <a href={links.google} target="_blank" rel="noopener noreferrer">{t("Google Календарь")}<ArrowUpRight size={18}/></a>
          <a href={links.outlook} target="_blank" rel="noopener noreferrer">Outlook<ArrowUpRight size={18}/></a>
          <Btn onClick={() => downloadCalendar([localized])}><DownloadSimple size={17}/>{t("Скачать .ics")}</Btn>
        </div>
        <p className={styles.note}>{t("Сохраните событие в открывшемся календаре. Файл .ics подходит для Apple Calendar и других календарей. Изменения даты и статуса нужно переносить повторно.")}</p>
        {(entry.kind === 'catalog' || entry.status === 'pending_manager') && <p className={styles.note}>{t("Участие ещё требует согласования руководителя.")}</p>}
      </Dialog>
    </Dialog.Root>
  </>;
}
