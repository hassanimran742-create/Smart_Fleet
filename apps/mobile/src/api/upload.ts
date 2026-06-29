import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const base = Constants.expoConfig?.extra?.apiBaseUrl ?? 'http://localhost:3000/api/v1';

/**
 * Let the user pick an image from the gallery (or take a photo) and upload it
 * to POST /files/upload. Returns the public S3 URL, or null if cancelled.
 *
 * We use fetch + FormData directly rather than the axios client because React
 * Native's multipart handling is finicky through axios; fetch with a
 * { uri, name, type } file object is the reliable path on Android.
 */
export async function pickAndUploadImage(opts: { camera?: boolean } = {}): Promise<string | null> {
  // Permissions
  if (opts.camera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission denied');
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Photo library permission denied');
  }

  const result = opts.camera
    ? await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images })
    : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  const token = await SecureStore.getItemAsync('accessToken');
  const form = new FormData();
  const name = asset.fileName ?? `upload-${Date.now()}.jpg`;
  const type = asset.mimeType ?? 'image/jpeg';
  // @ts-expect-error — RN FormData accepts this shape for file uploads
  form.append('file', { uri: asset.uri, name, type });

  const res = await fetch(`${base}/files/upload`, {
    method: 'POST',
    headers: {
      // NOTE: do NOT set Content-Type — fetch sets the multipart boundary.
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}) ${text}`.trim());
  }
  const data = await res.json();
  return data.url as string;
}
