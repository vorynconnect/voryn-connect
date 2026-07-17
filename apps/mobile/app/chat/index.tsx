import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

type Conversation = { id: string };
type Counterpart = { id: string; fullName: string; avatarUrl: string | null };
type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  imageUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Trip chat — two-party thread between customer and driver/courier, polled live. */
export default function ChatScreen() {
  const { context, referenceId, title, avatarUrl } = useLocalSearchParams<{
    context: 'RIDE' | 'ORDER';
    referenceId: string;
    title?: string;
    avatarUrl?: string;
  }>();
  const me = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');

  const conversationQuery = useQuery({
    queryKey: ['chat-conversation', context, referenceId],
    queryFn: () =>
      api<{ conversation: Conversation; counterpart: Counterpart }>('/v1/chat/conversations', {
        method: 'POST',
        body: { context, referenceId },
      }),
  });
  const conversationId = conversationQuery.data?.conversation.id;
  const counterpart = conversationQuery.data?.counterpart;

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: () => api<{ messages: ChatMessage[] }>(`/v1/chat/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
    refetchInterval: 3000,
  });
  const messages = messagesQuery.data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api<{ message: ChatMessage }>(`/v1/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-messages', conversationId] }),
  });

  useEffect(() => {
    // Keep the newest message in view as the thread grows.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body || !conversationId || sendMutation.isPending) return;
    setDraft('');
    sendMutation.mutate(body);
  };

  if (conversationQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Opening chat…" />
      </View>
    );
  }
  if (conversationQuery.isError || !conversationId) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => conversationQuery.refetch()} />
      </View>
    );
  }

  const headerName = counterpart?.fullName ?? title ?? 'Chat';
  const headerAvatar = counterpart?.avatarUrl ?? (avatarUrl || null);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader showBack />
      <View style={styles.headerCard}>
        <Avatar uri={headerAvatar} name={headerName} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{headerName}</Text>
          <Text style={styles.headerMeta}>
            {context === 'RIDE' ? 'Ride chat' : 'Delivery chat'} • messages update live
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles-outline" size={26} color={colors.blue} />
            </View>
            <Text style={styles.emptyTitle}>Say hello 👋</Text>
            <Text style={styles.emptyBody}>
              Messages here are only visible to you and {headerName.split(' ')[0]} for this trip.
            </Text>
          </View>
        ) : (
          messages.map((msg) => {
            const mine = msg.senderId === me?.id;
            return (
              <View key={msg.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.body}</Text>
                  <View style={styles.bubbleMeta}>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{fmtTime(msg.createdAt)}</Text>
                    {mine ? (
                      <Ionicons
                        name={msg.readAt ? 'checkmark-done' : 'checkmark'}
                        size={13}
                        color={mine ? 'rgba(255,255,255,0.85)' : colors.textSecondary}
                      />
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Type a message…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
          multiline
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || sendMutation.isPending) && styles.sendDisabled]}
          onPress={send}
        >
          <Ionicons name="send" size={18} color={colors.textOnBrand} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  headerName: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  headerMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  thread: { paddingHorizontal: spacing.lg, paddingBottom: spacing.base, gap: spacing.sm },
  emptyWrap: { alignItems: 'center', paddingTop: spacing['2xl'], gap: spacing.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  emptyBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: colors.blue, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 21 },
  bubbleTextMine: { color: colors.textOnBrand },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 3 },
  bubbleTime: { fontSize: 10, color: colors.textSecondary },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.85)' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
});
