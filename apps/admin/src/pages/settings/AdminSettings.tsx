// 005:T024 (B49; FR-624; R-410; the note under T024, Q-S1 (a), Q-X2 (a)): the settings page,
// `/settings`. Every key `settings.list` answers, under its group's heading, the groups in the
// contract's order (`GROUP_ORDER`) and the keys in the list's, which is the registry's. Each row: the
// label, the value with its unit, the default (the registry's, which is the seed's value; B49's
// Q-A1 (a)) drawn as a value is, the bounds, the SRS §3.14 row it governs, and the change
// (`SettingDialog`). `rate_limit_signed_in_default` is marked as applying within 60 s. The page says
// that a change applies prospectively and is audited, and leads to the administrators
// (`/settings/admins`), the settings section's other page.
//
// The columns are one list (`COLUMNS`), so a further field of a row is one entry.
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  type Content,
  DataTable,
  type DataTableColumn,
  Page,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type Locale, type MessageKey, type MessageValues, useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { type SettingRow, useSettings } from './queries';
import { SettingDialog } from './SettingDialog';
import {
  boundsText,
  GROUP_LABEL,
  GROUP_ORDER,
  labelKey,
  SIGNED_IN_DEFAULT,
  valueText,
} from './words';

const ADMINS_PATH = '/settings/admins';

type Translate = (key: MessageKey, values?: MessageValues) => string;

interface Column {
  readonly table: Omit<DataTableColumn, 'header'>;
  readonly header: MessageKey;
  readonly cell: (
    setting: SettingRow,
    words: { readonly t: Translate; readonly locale: Locale; readonly change: () => void },
  ) => Content;
}

const COLUMNS: readonly Column[] = [
  {
    table: { key: 'setting', wrap: true },
    header: 'admin.settings.columns.setting',
    cell: (setting, { t }) => t(labelKey(setting.key)),
  },
  {
    table: { key: 'value' },
    header: 'admin.settings.columns.value',
    cell: (setting, { t, locale }) => (
      <span className="stack gap-1">
        <span>{valueText(t, locale, setting)}</span>
        {setting.key === SIGNED_IN_DEFAULT ? (
          <Badge label={t('admin.settings.withinMinute')} tone="warning" icon={{ name: 'clock' }} />
        ) : null}
      </span>
    ),
  },
  {
    table: { key: 'default' },
    header: 'admin.settings.columns.default',
    cell: (setting, { t, locale }) =>
      valueText(t, locale, { value: setting.default, unit: setting.unit }),
  },
  {
    table: { key: 'bounds', wrap: true },
    header: 'admin.settings.columns.bounds',
    // 006:T002 (Q-6): the setting's unit, so an amount's bound is written in pounds.
    cell: (setting, { t, locale }) => boundsText(t, locale, setting),
  },
  {
    table: { key: 'srsRow', wrap: true },
    header: 'admin.settings.columns.srsRow',
    cell: (setting) => <span className="text-caption tone-muted">{setting.srsRow}</span>,
  },
  {
    table: { key: 'action', end: true },
    header: 'admin.settings.columns.action',
    cell: (setting, { t, change }) => (
      <Button
        label={t('admin.settings.change')}
        accessibilityLabel={t('admin.settings.changeA11y', { setting: t(labelKey(setting.key)) })}
        variant="secondary"
        onPress={change}
      />
    ),
  },
];

export function AdminSettings() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const list = useSettings();
  const [changing, setChanging] = useState<SettingRow | null>(null);

  const listed = list.data;
  const body = (() => {
    if (listed === undefined) {
      if (!list.isError) return <Skeleton shape="block" />;
      const failure = errorMessageKey(list.error, 'admin.common.loadError.text');
      return (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.settings.title') })}
              </strong>
              <span>{t(failure.key, failure.values)}</span>
            </span>
          </Banner>
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void list.refetch()}
            />
          </div>
        </div>
      );
    }
    return GROUP_ORDER.map((group) => {
      const settings = listed.items.filter((setting) => setting.group === group);
      if (settings.length === 0) return null;
      return (
        <section key={group} className="section" aria-label={t(GROUP_LABEL[group])}>
          <h2 className="group-label">{t(GROUP_LABEL[group])}</h2>
          <DataTable
            columns={COLUMNS.map(({ table, header }) => ({ ...table, header: t(header) }))}
            rows={settings.map((setting) => ({
              key: setting.key,
              cells: Object.fromEntries(
                COLUMNS.map(({ table, cell }) => [
                  table.key,
                  cell(setting, { t, locale, change: () => setChanging(setting) }),
                ]),
              ),
            }))}
          />
        </section>
      );
    });
  })();

  return (
    <Page
      title={t('admin.settings.title')}
      subtitle={t('admin.settings.lede')}
      actions={
        <TextLink
          label={t('admin.admins.title')}
          href={ADMINS_PATH}
          onPress={() => void navigate(ADMINS_PATH)}
        />
      }
    >
      <Banner icon={{ name: 'info' }} tone="info">
        {t('admin.settings.banner')}
      </Banner>
      {body}
      {changing === null ? null : (
        <SettingDialog setting={changing} onClose={() => setChanging(null)} />
      )}
    </Page>
  );
}
