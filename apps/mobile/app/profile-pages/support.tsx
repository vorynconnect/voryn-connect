import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

const SUPPORT_PHONE = '+18765550000';
const SUPPORT_EMAIL = 'support@vorynconnect.com';

const FAQS = [
  {
    q: 'Where is my order?',
    a: 'Open the Orders tab and tap your order to see live tracking, the provider’s status, and your courier or driver’s location.',
  },
  {
    q: 'How do refunds work?',
    a: 'When an order or booking is cancelled, wallet payments are refunded instantly to your Voryn Wallet. Card refunds are returned through the card network and can take 3–5 business days.',
  },
  {
    q: 'Who provides the services on Voryn Connect?',
    a: 'Every restaurant, store, driver, technician, and service business on Voryn Connect is an independent third-party provider. Pricing is set by the provider.',
  },
  {
    q: 'How do I earn and use points?',
    a: 'You earn points on completed orders and bookings. Redeem them in Wallet → Redeem points — 500 pts gives you JMD 250 in wallet credit.',
  },
  {
    q: 'Is my wallet money safe?',
    a: 'Your balance is held securely and protected by your wallet PIN. Set or change your PIN in Profile → Privacy & security.',
  },
];

type SupportTicket = {
  id: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  createdAt: string;
};

const STATUS_LABEL: Record<SupportTicket['status'], string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Needs your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const OPEN_STATUSES: SupportTicket['status'][] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];

/** Support — 24/7 contact channels, support tickets, and common answers. */
export default function SupportScreen() {
  const queryClient = useQueryClient();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => api<{ tickets: SupportTicket[] }>('/v1/support/tickets'),
  });
  const tickets = ticketsQuery.data?.tickets ?? [];

  const createTicket = useMutation({
    mutationFn: () =>
      api<{ ticket: SupportTicket }>('/v1/support/tickets', {
        method: 'POST',
        body: { subject: subject.trim(), description: description.trim() },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      setFormOpen(false);
      setSubject('');
      setDescription('');
      setFormError(null);
      setDialog({
        title: 'Message sent',
        message: 'Our support team has your request and will get back to you as soon as possible.',
      });
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.message : 'Could not send your message. Please try again.'),
  });

  const submitTicket = () => {
    if (subject.trim().length < 3) {
      setFormError('Add a short subject (at least 3 characters).');
      return;
    }
    if (description.trim().length < 10) {
      setFormError('Tell us a little more (at least 10 characters).');
      return;
    }
    setFormError(null);
    createTicket.mutate();
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Support</Text>
        <Text style={styles.subtitle}>We’re here 24/7. How can we help?</Text>

        <View style={styles.contactRow}>
          <Pressable style={styles.contactTile} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
            <View style={styles.contactIcon}>
              <Ionicons name="call-outline" size={22} color={colors.blue} />
            </View>
            <Text style={styles.contactTitle}>Call us</Text>
            <Text style={styles.contactBody}>24/7 hotline</Text>
          </Pressable>
          <Pressable
            style={styles.contactTile}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Voryn%20Connect%20support`)}
          >
            <View style={styles.contactIcon}>
              <Ionicons name="mail-outline" size={22} color={colors.blue} />
            </View>
            <Text style={styles.contactTitle}>Email</Text>
            <Text style={styles.contactBody}>Replies within a day</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Message support</Text>
        <Card>
          {formOpen ? (
            <View style={styles.form}>
              <BrandTextField
                icon="chatbox-ellipses-outline"
                placeholder="Subject"
                value={subject}
                onChangeText={setSubject}
                maxLength={150}
              />
              <BrandTextField
                icon="create-outline"
                placeholder="Describe what happened…"
                value={description}
                onChangeText={setDescription}
                maxLength={2000}
                multiline
                numberOfLines={4}
              />
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}
              <GradientButton title="Send message" onPress={submitTicket} loading={createTicket.isPending} />
              <Pressable onPress={() => setFormOpen(false)} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.newTicketRow} onPress={() => setFormOpen(true)}>
              <View style={styles.contactIcon}>
                <Ionicons name="chatbubbles-outline" size={22} color={colors.blue} />
              </View>
              <View style={styles.flexFill}>
                <Text style={styles.contactTitle}>Open a support ticket</Text>
                <Text style={styles.contactBody}>Tell us about an order, ride, payment, or anything else.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </Card>

        {tickets.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Your tickets</Text>
            <Card padded={false}>
              {tickets.map((ticket, i) => {
                const isOpen = OPEN_STATUSES.includes(ticket.status);
                return (
                  <View
                    key={ticket.id}
                    style={[styles.ticketRow, i < tickets.length - 1 ? styles.faqBorder : undefined]}
                  >
                    <View style={styles.flexFill}>
                      <Text style={styles.faqQuestion} numberOfLines={1}>
                        {ticket.subject}
                      </Text>
                      <Text style={styles.contactBody} numberOfLines={2}>
                        {ticket.description}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, isOpen ? styles.statusOpen : styles.statusDone]}>
                      <Text style={[styles.statusText, isOpen ? styles.statusTextOpen : styles.statusTextDone]}>
                        {STATUS_LABEL[ticket.status]}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Common questions</Text>
        <Card padded={false}>
          {FAQS.map((faq, i) => {
            const open = openIndex === i;
            return (
              <View key={faq.q} style={i < FAQS.length - 1 ? styles.faqBorder : undefined}>
                <Pressable style={styles.faqRow} onPress={() => setOpenIndex(open ? null : i)}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textSecondary} />
                </Pressable>
                {open ? <Text style={styles.faqAnswer}>{faq.a}</Text> : null}
              </View>
            );
          })}
        </Card>

        <View style={styles.providerNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.providerNoteText}>
            Services on Voryn Connect are fulfilled by trusted third-party providers.
          </Text>
        </View>
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flexFill: { flex: 1 },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  contactRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  contactTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingVertical: spacing.lg,
    shadowColor: '#16305D',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  contactIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  contactTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  contactBody: { fontSize: fontSize.xs, color: colors.textSecondary },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  newTicketRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  form: { gap: spacing.md },
  formError: { color: colors.danger, fontSize: fontSize.sm },
  cancelLink: { alignSelf: 'center', paddingVertical: spacing.xs },
  cancelLinkText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  statusOpen: { backgroundColor: colors.skyTint },
  statusDone: { backgroundColor: colors.background },
  statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  statusTextOpen: { color: colors.blue },
  statusTextDone: { color: colors.textSecondary },
  faqBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.base,
  },
  faqQuestion: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  faqAnswer: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  providerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.lg },
  providerNoteText: { fontSize: fontSize.xs, color: colors.textSecondary },
});
