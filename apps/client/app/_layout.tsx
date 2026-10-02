import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '../src/features/auth/auth-store';
import { usePreferencesSync } from '../src/features/auth/prefs-sync';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => {
    void useAuth.getState().init(); // restore the session from the stored refresh token
  }, []);
  usePreferencesSync();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0f1115' }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0f1115' } }}
        />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
