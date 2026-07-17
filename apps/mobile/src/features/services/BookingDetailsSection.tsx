import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { BrandTextField } from '@/components/BrandTextField';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import type { Vertical } from '@/features/services/config';

export type CustomerVehicle = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plateNo: string | null;
};

export type BookingDetails = {
  customerVehicleId?: string;
  deviceDescription?: string;
  issueDescription?: string;
};

type Props = {
  vertical: Vertical;
  value: BookingDetails;
  onChange: (details: BookingDetails) => void;
};

/**
 * Vertical-specific booking details from the approved mockups:
 *  - Auto Care: the customer's vehicle ("2016 Toyota Axio • Change vehicle")
 *  - Technicians: the device and its issue ("Dell Inspiron 15 • Cracked screen")
 *  - Home Services: covered by the job-location selector on the parent screen
 */
export function BookingDetailsSection({ vertical, value, onChange }: Props) {
  if (vertical === 'AUTO_CARE') {
    return <VehicleSection selectedId={value.customerVehicleId} onSelect={(id) => onChange({ ...value, customerVehicleId: id })} />;
  }
  if (vertical === 'TECHNICIAN') {
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Your device</Text>
        <TextInput
          style={styles.input}
          placeholder="Device (e.g. Dell Inspiron 15)"
          placeholderTextColor={colors.textMuted}
          value={value.deviceDescription ?? ''}
          onChangeText={(deviceDescription) => onChange({ ...value, deviceDescription })}
          maxLength={200}
        />
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Describe the issue (e.g. Cracked screen, won't power on)"
          placeholderTextColor={colors.textMuted}
          value={value.issueDescription ?? ''}
          onChangeText={(issueDescription) => onChange({ ...value, issueDescription })}
          multiline
          maxLength={1000}
        />
      </Card>
    );
  }
  return null;
}

function VehicleSection({ selectedId, onSelect }: { selectedId?: string; onSelect: (id: string | undefined) => void }) {
  const [pickerVisible, setPickerVisible] = useState(false);

  const vehiclesQuery = useQuery({
    queryKey: ['customer-vehicles'],
    queryFn: () => api<{ vehicles: CustomerVehicle[] }>('/v1/bookings/vehicles/mine'),
  });
  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const selected = vehicles.find((v) => v.id === selectedId) ?? vehicles[0];

  // Keep the parent in sync with the effective default selection.
  useEffect(() => {
    if (selected && selected.id !== selectedId) onSelect(selected.id);
  }, [selected, selectedId, onSelect]);

  return (
    <>
      <Card style={styles.card}>
        {selected ? (
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleIcon}>
              <Ionicons name="car" size={24} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>
                {selected.year ? `${selected.year} ` : ''}
                {selected.make} {selected.model}
              </Text>
              <View style={styles.vehicleMetaRow}>
                {selected.plateNo ? (
                  <View style={styles.plateBadge}>
                    <Text style={styles.plateText}>{selected.plateNo}</Text>
                  </View>
                ) : null}
                {selected.color ? <Text style={styles.vehicleMeta}>{selected.color}</Text> : null}
              </View>
            </View>
            <Pressable style={styles.changeButton} onPress={() => setPickerVisible(true)} hitSlop={6}>
              <Text style={styles.changeText}>Change vehicle</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.blue} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.vehicleRow} onPress={() => setPickerVisible(true)}>
            <View style={styles.vehicleIcon}>
              <Ionicons name="add" size={24} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>Add your vehicle</Text>
              <Text style={styles.vehicleMeta}>The provider needs to know what they’re servicing.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </Card>
      <VehiclePickerModal
        visible={pickerVisible}
        vehicles={vehicles}
        selectedId={selected?.id}
        onClose={() => setPickerVisible(false)}
        onSelect={(id) => {
          onSelect(id);
          setPickerVisible(false);
        }}
      />
    </>
  );
}

function VehiclePickerModal({
  visible,
  vehicles,
  selectedId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  vehicles: CustomerVehicle[];
  selectedId?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [color, setColor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      api<{ vehicle: CustomerVehicle }>('/v1/bookings/vehicles', {
        method: 'POST',
        body: {
          make: make.trim(),
          model: model.trim(),
          ...(year.trim() ? { year: Number(year.trim()) } : {}),
          ...(plateNo.trim() ? { plateNo: plateNo.trim() } : {}),
          ...(color.trim() ? { color: color.trim() } : {}),
        },
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['customer-vehicles'] });
      setAdding(false);
      setMake('');
      setModel('');
      setYear('');
      setPlateNo('');
      setColor('');
      onSelect(data.vehicle.id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save your vehicle.'),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>{adding ? 'Add a vehicle' : 'Your vehicles'}</Text>
          {adding ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <BrandTextField icon="car-outline" placeholder="Make (e.g. Toyota)" value={make} onChangeText={setMake} />
              <BrandTextField icon="car-sport-outline" placeholder="Model (e.g. Axio)" value={model} onChangeText={setModel} />
              <BrandTextField icon="calendar-outline" placeholder="Year (optional)" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
              <BrandTextField icon="pricetag-outline" placeholder="Plate number (optional)" value={plateNo} onChangeText={setPlateNo} autoCapitalize="characters" />
              <BrandTextField icon="color-palette-outline" placeholder="Colour (optional)" value={color} onChangeText={setColor} />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <GradientButton
                title="Save vehicle"
                icon="checkmark"
                loading={addMutation.isPending}
                disabled={!make.trim() || !model.trim()}
                onPress={() => {
                  setError(null);
                  addMutation.mutate();
                }}
              />
              <Pressable style={styles.modalCancel} onPress={() => setAdding(false)}>
                <Text style={styles.modalCancelText}>Back</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <>
              {vehicles.map((vehicle) => {
                const active = vehicle.id === selectedId;
                return (
                  <Pressable
                    key={vehicle.id}
                    style={[styles.pickRow, active && styles.pickRowActive]}
                    onPress={() => onSelect(vehicle.id)}
                  >
                    <Ionicons name="car" size={20} color={colors.blue} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.vehicleName}>
                        {vehicle.year ? `${vehicle.year} ` : ''}
                        {vehicle.make} {vehicle.model}
                      </Text>
                      {vehicle.plateNo ? <Text style={styles.vehicleMeta}>{vehicle.plateNo}</Text> : null}
                    </View>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                  </Pressable>
                );
              })}
              <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
                <Ionicons name="add-circle-outline" size={20} color={colors.blue} />
                <Text style={styles.addRowText}>Add a new vehicle</Text>
              </Pressable>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>Close</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  cardTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    marginBottom: spacing.md,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top', marginBottom: 0 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  vehicleMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  plateBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  plateText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.xs, letterSpacing: 1 },
  vehicleMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  changeButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  changeText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(22,48,93,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing['2xl'],
    maxHeight: '85%',
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.base },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  pickRowActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  addRowText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  modalCancel: { alignItems: 'center', paddingVertical: spacing.md },
  modalCancelText: { color: colors.textSecondary, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
});
