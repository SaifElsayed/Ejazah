// T032 (review of B6, finding 6): the render harness catches what it exists to catch, a physical
// side, a raw colour in a style or in a colour prop, and a literal that equals a light token.
import { describe, expect, it } from '@jest/globals';
import { Text, TextInput, View } from 'react-native';

import { tokens } from '../../tokens';
import { inBothDirections } from './harness';

const fails = async (ui: () => React.ReactElement) => {
  let failed = false;
  try {
    await inBothDirections(ui);
  } catch {
    failed = true;
  }
  return failed;
};

describe('the render harness', () => {
  it('passes a view drawn with logical sides and token colours', async () => {
    expect(
      await fails(() => (
        <View style={{ marginStart: tokens.space['2'] }}>
          <Text>ok</Text>
        </View>
      )),
    ).toBe(false);
  });

  it('fails a physical side', async () => {
    // eslint-disable-next-line ijazah/mobile/no-physical-direction -- T032 the harness's own spec plants the side it must catch
    expect(await fails(() => <View style={{ marginLeft: tokens.space['2'] }} />)).toBe(true);
  });

  it('fails a raw colour in a style', async () => {
    expect(await fails(() => <View style={{ backgroundColor: '#123456' }} />)).toBe(true);
  });

  it('fails a raw colour in a colour prop', async () => {
    expect(
      await fails(() => <TextInput value="" placeholder="x" placeholderTextColor="#123456" />),
    ).toBe(true);
  });

  it('fails a literal that equals a light token, through the dark run', async () => {
    // A light colour no dark token shares: the dark run is the one that sees it.
    const darkValues = new Set<string>(Object.values(tokens.color.dark));
    const lightOnly = Object.values(tokens.color.light).find((value) => !darkValues.has(value));
    expect(lightOnly).toBeDefined();
    expect(await fails(() => <View style={{ backgroundColor: lightOnly }} />)).toBe(true);
  });
});
