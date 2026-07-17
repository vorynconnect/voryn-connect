import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';
import type { CustomerProfile, SessionUser } from '@/stores/auth';

export type AvatarUploadResult = { user: SessionUser; profile: CustomerProfile };

/**
 * Open the photo library, then upload the chosen image to /v1/users/me/avatar.
 * Resolves null when the user cancels the picker.
 */
export async function pickAndUploadAvatar(): Promise<AvatarUploadResult | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const form = new FormData();
  if (Platform.OS === 'web') {
    // Web picker returns a blob/data URI; multipart needs a real Blob part.
    const blob = await (await fetch(asset.uri)).blob();
    (form as unknown as { append: (name: string, value: Blob, fileName?: string) => void }).append(
      'image',
      blob,
      asset.fileName ?? 'avatar.jpg',
    );
  } else {
    form.append('image', {
      uri: asset.uri,
      name: asset.fileName ?? 'avatar.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }

  return api<AvatarUploadResult>('/v1/users/me/avatar', { method: 'POST', body: form });
}
