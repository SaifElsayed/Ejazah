// T022 (FR-313, FR-317, FR-318; screens.md §13): the teacher's availability against its boards, in
// both languages. The slots by weekday, Saturday first, in their three states with the legend and
// the days without slots; the empty state; the editor creating and editing a slot of 30, 45 or 60
// minutes, keyed on create; `SLOT_OVERLAP` and `SLOT_IN_USE` said in place; a free slot disabled
// at once and a disabled one enabled again; a booked slot opens the editor with its day, start and
// length fixed (FR-318) and is disabled through `SlotDisableSheet` (FR-PROFILE-9; the owner's
// decision of 2026-11-02, B26).
import type { TeacherSlot } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import type { Direction } from '../../../lib/direction';
import { formatWallClock, formatWeekday } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { SlotEditor } from './components/SlotEditor';
import { Availability } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `slot-key-${++mockKey}` }));

const ZONE = 'Africa/Cairo';

function slot(
  id: string,
  dayOfWeek: number,
  startTimeLocal: string,
  durationMinutes: 30 | 45 | 60,
  state: TeacherSlot['state'],
): TeacherSlot {
  return {
    id: `0193a6f0-0000-7000-8000-0000000000${id}`,
    dayOfWeek,
    startTimeLocal,
    durationMinutes,
    timezone: ZONE,
    isActive: state !== 'disabled',
    state,
  };
}

const SAT_BOOKED = slot('01', 6, '10:00', 45, 'booked');
const SAT_FREE = slot('02', 6, '11:00', 60, 'free');
const SUN_FREE = slot('03', 0, '19:30', 45, 'free');
const TUE_DISABLED = slot('04', 2, '21:00', 45, 'disabled');
const SLOTS = [SUN_FREE, TUE_DISABLED, SAT_FREE, SAT_BOOKED];

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const day = (direction: Direction, dayOfWeek: number) =>
  formatWeekday(dayOfWeek, localeOf(direction));
const time = (direction: Direction, start: string) => formatWallClock(start, localeOf(direction));

/** A slot's button by its accessibility label. */
function slotButton(direction: Direction, of: TeacherSlot) {
  const key: MessageKey =
    of.state === 'booked'
      ? 'teacher.availability.a11y.editSlotBooked'
      : of.state === 'disabled'
        ? 'teacher.availability.a11y.editSlotDisabled'
        : 'teacher.availability.a11y.editSlot';
  return screen.getByRole('button', {
    name: said(direction, key, {
      day: day(direction, of.dayOfWeek),
      time: time(direction, of.startTimeLocal),
    }),
  });
}

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

function listed(slots: readonly TeacherSlot[]) {
  mockApi.api.teacher.slots.list.query.mockResolvedValue({ timezone: ZONE, slots });
}

beforeEach(() => {
  mockApi = fakeApi();
  mockKey = 0;
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('Availability', () => {
  it('lists the slots by weekday, Saturday first, in their three states with the legend', async () => {
    listed(SLOTS);
    await inBothDirections(
      withQueries(() => <Availability />),
      async (rendered, direction) => {
        expect(
          await screen.findByText(
            said(direction, 'teacher.availability.subtitle', {
              city: direction === 'rtl' ? 'القاهرة' : 'Cairo',
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.availability.title'))).toBeTruthy();
        for (const listedSlot of SLOTS) {
          expect(
            screen.getByText(
              said(direction, 'teacher.availability.slot', {
                time: time(direction, listedSlot.startTimeLocal),
                minutes: listedSlot.durationMinutes,
              }),
            ),
          ).toBeTruthy();
          expect(slotButton(direction, listedSlot)).toBeTruthy();
        }
        // Saturday, then Sunday, then Tuesday; each day's slots by their start.
        const drawn = JSON.stringify(rendered.toJSON());
        const at = (text: string) => drawn.indexOf(text);
        expect(at(day(direction, 6))).toBeLessThan(at(day(direction, 0)));
        expect(at(day(direction, 0))).toBeLessThan(at(day(direction, 2)));
        expect(at(time(direction, '10:00'))).toBeLessThan(at(time(direction, '11:00')));
        expect(
          screen.getByText(
            said(direction, 'teacher.availability.noSlotsOn', {
              days: [1, 3, 4, 5]
                .map((dayOfWeek) => day(direction, dayOfWeek))
                .join(said(direction, 'teacher.availability.daysSeparator')),
            }),
          ),
        ).toBeTruthy();
        for (const legend of ['booked', 'free', 'disabled'] as const) {
          expect(
            screen.getByText(said(direction, `teacher.availability.legend.${legend}`)),
          ).toBeTruthy();
        }
        expect(
          screen.getByRole('button', { name: said(direction, 'teacher.availability.addSlot') }),
        ).toBeTruthy();
      },
    );
  });

  it('opens a booked slot in the editor with its fields fixed, and disables it through the sheet', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      mockApi.api.teacher.slots.update.mutate.mockClear();
      mockApi.api.teacher.slots.update.mutate.mockResolvedValue({
        ...SAT_BOOKED,
        isActive: false,
        state: 'disabled',
      });
      listed(SLOTS);
      await renderIn(direction, withQueries(() => <Availability />)());
      await screen.findByText(said(direction, 'teacher.availability.title'));
      await waitFor(() => expect(slotButton(direction, SAT_BOOKED)).toBeTruthy());
      const booked = slotButton(direction, SAT_BOOKED);
      expect(booked.props['accessibilityState']).toMatchObject({ disabled: false });
      await fireEvent.press(booked);
      expect(
        await screen.findByText(said(direction, 'teacher.availability.editor.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'teacher.availability.editor.error.inUse')),
      ).toBeTruthy();
      // The day, the start and the length are shown, not offered: no day chip, no start picker.
      expect(
        screen.getByText(
          said(direction, 'teacher.availability.editor.durationOption', {
            minutes: SAT_BOOKED.durationMinutes,
          }),
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: day(direction, 6) })).toBeNull();
      expect(
        screen.queryByRole('button', { name: said(direction, 'teacher.availability.editor.save') }),
      ).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: said(direction, 'teacher.availability.editor.starts'),
        }),
      ).toBeNull();
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'teacher.availability.editor.disable'),
        }),
      );
      await screen.findByText(
        said(direction, 'teacher.availability.disableSheet.title', {
          day: day(direction, 6),
          time: time(direction, '10:00'),
        }),
      );
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'teacher.availability.disableSheet.confirm'),
        }),
      );
      await waitFor(() =>
        expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenCalledWith({
          slotId: SAT_BOOKED.id,
          isActive: false,
        }),
      );
      expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenCalledTimes(1);
    }
  });

  it('draws the empty state with the add button when there is no slot', async () => {
    listed([]);
    await inBothDirections(
      withQueries(() => <Availability />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.availability.empty.title')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.availability.empty.text'))).toBeTruthy();
        expect(
          screen.getByRole('button', { name: said(direction, 'teacher.availability.addSlot') }),
        ).toBeTruthy();
        expect(screen.queryByText(said(direction, 'teacher.availability.legend.free'))).toBeNull();
      },
    );
  });

  it('says a failed read with its retry', async () => {
    mockApi.api.teacher.slots.list.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <Availability />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    listed([]);
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(ar('teacher.availability.empty.title'))).toBeTruthy();
  });
});

describe('SlotEditor', () => {
  async function openNew(direction: Direction) {
    await renderIn(direction, withQueries(() => <Availability />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: said(direction, 'teacher.availability.addSlot') }),
    );
    expect(
      await screen.findByText(said(direction, 'teacher.availability.editor.newTitle')),
    ).toBeTruthy();
  }

  async function chooseNew(
    direction: Direction,
    dayOfWeek: number,
    start: string,
    minutes: number,
  ) {
    await fireEvent.press(screen.getByRole('button', { name: day(direction, dayOfWeek) }));
    await fireEvent.press(
      screen.getByRole('button', { name: said(direction, 'teacher.availability.editor.starts') }),
    );
    await fireEvent.press(await screen.findByText(time(direction, start)));
    await fireEvent.press(
      await screen.findByRole('radio', {
        name: said(direction, 'teacher.availability.editor.durationOption', { minutes }),
      }),
    );
  }

  const save = (direction: Direction) =>
    screen.getByRole('button', { name: said(direction, 'teacher.availability.editor.save') });

  it('creates a slot of a day, a start and 30 minutes, keyed, then reads the slots again', async () => {
    listed([]);
    await openNew('rtl');
    // No disable button for a new slot, and nothing to save before the three are chosen.
    expect(screen.queryByText(ar('teacher.availability.editor.disable'))).toBeNull();
    expect(save('rtl').props['accessibilityState']).toMatchObject({ disabled: true });
    expect(
      screen.getByText(ar('teacher.availability.editor.timeZoneHint', { city: 'القاهرة' })),
    ).toBeTruthy();
    await chooseNew('rtl', 0, '17:00', 30);
    mockApi.api.teacher.slots.create.mutate.mockResolvedValue(SUN_FREE);
    listed([SUN_FREE]);
    await fireEvent.press(save('rtl'));
    await waitFor(() =>
      expect(mockApi.api.teacher.slots.create.mutate).toHaveBeenCalledWith({
        dayOfWeek: 0,
        startTimeLocal: '17:00',
        durationMinutes: 30,
        idempotencyKey: 'slot-key-1',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(ar('teacher.availability.editor.newTitle'))).toBeNull(),
    );
    expect(mockApi.api.teacher.slots.list.query).toHaveBeenCalledTimes(2);
  });

  it('offers the three lengths, 30, 45 and 60 minutes', async () => {
    listed([]);
    await openNew('ltr');
    for (const minutes of [30, 45, 60]) {
      expect(
        screen.getByRole('radio', {
          name: said('ltr', 'teacher.availability.editor.durationOption', { minutes }),
        }),
      ).toBeTruthy();
    }
  });

  it('edits a free slot and sends only its new length, 60', async () => {
    listed([SAT_FREE, SUN_FREE]);
    await renderIn('rtl', withQueries(() => <Availability />)());
    await screen.findByText(ar('teacher.availability.title'));
    await waitFor(() => expect(slotButton('rtl', SUN_FREE)).toBeTruthy());
    await fireEvent.press(slotButton('rtl', SUN_FREE));
    expect(await screen.findByText(ar('teacher.availability.editor.title'))).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('radio', {
        name: ar('teacher.availability.editor.durationOption', { minutes: 60 }),
      }),
    );
    mockApi.api.teacher.slots.update.mutate.mockResolvedValue({ ...SUN_FREE, durationMinutes: 60 });
    await fireEvent.press(save('rtl'));
    await waitFor(() =>
      expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenCalledWith({
        slotId: SUN_FREE.id,
        durationMinutes: 60,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(ar('teacher.availability.editor.title'))).toBeNull(),
    );
  });

  it('says SLOT_OVERLAP plainly and keeps the editor open, in both languages', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      listed([]);
      mockApi.api.teacher.slots.create.mutate.mockRejectedValue(apiError('SLOT_OVERLAP'));
      await openNew(direction);
      await chooseNew(direction, 0, '19:00', 60);
      await fireEvent.press(save(direction));
      expect(
        await screen.findByText(said(direction, 'teacher.availability.editor.error.overlap')),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'teacher.availability.editor.newTitle')),
      ).toBeTruthy();
      await screen.unmount();
    }
  });

  it('says SLOT_IN_USE plainly when the slot was booked meanwhile, in both languages', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      listed([SAT_FREE]);
      mockApi.api.teacher.slots.update.mutate.mockRejectedValue(apiError('SLOT_IN_USE'));
      await renderIn(direction, withQueries(() => <Availability />)());
      await screen.findByText(said(direction, 'teacher.availability.title'));
      await waitFor(() => expect(slotButton(direction, SAT_FREE)).toBeTruthy());
      await fireEvent.press(slotButton(direction, SAT_FREE));
      await fireEvent.press(
        await screen.findByRole('radio', {
          name: said(direction, 'teacher.availability.editor.durationOption', { minutes: 30 }),
        }),
      );
      await fireEvent.press(save(direction));
      expect(
        await screen.findByText(said(direction, 'teacher.availability.editor.error.inUse')),
      ).toBeTruthy();
      await screen.unmount();
    }
  });

  it('says any other refusal as the generic failure', async () => {
    listed([]);
    mockApi.api.teacher.slots.create.mutate.mockRejectedValue(apiError('INTERNAL'));
    await openNew('rtl');
    await chooseNew('rtl', 3, '08:00', 45);
    await fireEvent.press(save('rtl'));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
  });

  it('disables a free slot at once, without the sheet', async () => {
    listed([SAT_FREE]);
    mockApi.api.teacher.slots.update.mutate.mockResolvedValue({
      ...SAT_FREE,
      isActive: false,
      state: 'disabled',
    });
    await renderIn('rtl', withQueries(() => <Availability />)());
    await screen.findByText(ar('teacher.availability.title'));
    await waitFor(() => expect(slotButton('rtl', SAT_FREE)).toBeTruthy());
    await fireEvent.press(slotButton('rtl', SAT_FREE));
    expect(await screen.findByText(ar('teacher.availability.editor.disableNote'))).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.availability.editor.disable') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenCalledWith({
        slotId: SAT_FREE.id,
        isActive: false,
      }),
    );
    expect(screen.queryByText(ar('teacher.availability.disableSheet.textBooked'))).toBeNull();
  });

  it('enables a disabled slot again, and says an overlap on enabling', async () => {
    listed([TUE_DISABLED]);
    await renderIn('rtl', withQueries(() => <Availability />)());
    await screen.findByText(ar('teacher.availability.title'));
    await waitFor(() => expect(slotButton('rtl', TUE_DISABLED)).toBeTruthy());
    await fireEvent.press(slotButton('rtl', TUE_DISABLED));
    expect(await screen.findByText(ar('teacher.availability.editor.title'))).toBeTruthy();
    expect(screen.queryByText(ar('teacher.availability.editor.disable'))).toBeNull();
    mockApi.api.teacher.slots.update.mutate.mockRejectedValueOnce(apiError('SLOT_OVERLAP'));
    const enable = screen.getByRole('button', { name: ar('teacher.availability.editor.enable') });
    await fireEvent.press(enable);
    expect(await screen.findByText(ar('teacher.availability.editor.error.overlap'))).toBeTruthy();
    mockApi.api.teacher.slots.update.mutate.mockResolvedValue({
      ...TUE_DISABLED,
      isActive: true,
      state: 'free',
    });
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.availability.editor.enable') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenLastCalledWith({
        slotId: TUE_DISABLED.id,
        isActive: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(ar('teacher.availability.editor.title'))).toBeNull(),
    );
  });
});

describe('SlotDisableSheet', () => {
  it('disables a booked slot through the sheet; cancel returns to the editor', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      const closed = jest.fn();
      mockApi.api.teacher.slots.update.mutate.mockResolvedValue({
        ...SAT_BOOKED,
        isActive: false,
        state: 'disabled',
      });
      await renderIn(
        direction,
        withQueries(() => <SlotEditor slot={SAT_BOOKED} timezone={ZONE} onClose={closed} />)(),
      );
      const title = said(direction, 'teacher.availability.disableSheet.title', {
        day: day(direction, 6),
        time: time(direction, '10:00'),
      });
      const disable = said(direction, 'teacher.availability.editor.disable');
      await fireEvent.press(screen.getByRole('button', { name: disable }));
      expect(await screen.findByText(title)).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'teacher.availability.disableSheet.textBooked')),
      ).toBeTruthy();
      expect(mockApi.api.teacher.slots.update.mutate).not.toHaveBeenCalled();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'common.action.cancel') }),
      );
      expect(
        await screen.findByText(said(direction, 'teacher.availability.editor.title')),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: disable }));
      await screen.findByText(title);
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'teacher.availability.disableSheet.confirm'),
        }),
      );
      await waitFor(() =>
        expect(mockApi.api.teacher.slots.update.mutate).toHaveBeenCalledWith({
          slotId: SAT_BOOKED.id,
          isActive: false,
        }),
      );
      await waitFor(() => expect(closed).toHaveBeenCalled());
      await screen.unmount();
      mockApi = fakeApi();
    }
  });
});
