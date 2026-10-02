import { Redirect, useLocalSearchParams } from 'expo-router';

/** Invite deep link: /join/ABCD23 opens the online hub with the code filled in. */
export default function JoinByLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/play/online', params: { code: String(code ?? '') } }} />;
}
