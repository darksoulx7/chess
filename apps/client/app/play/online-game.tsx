import { useLocalSearchParams } from 'expo-router';
import { OnlineGameScreen } from '../../src/features/online/OnlineGameScreen';

export default function OnlineGame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OnlineGameScreen id={String(id)} />;
}
