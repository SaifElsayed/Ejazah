// T022 fixture — VIOLATION of R-MOBILE-10: a session token written to plain AsyncStorage from a
// feature file. Anything sensitive belongs in SecureStore, behind `lib/storage`.
// Refused by mobile/no-insecure-storage.
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function rememberSessionToken(token: string): Promise<void> {
  await AsyncStorage.setItem('session.token', token);
}
