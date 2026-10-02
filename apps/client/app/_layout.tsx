import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
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
