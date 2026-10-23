import * as ImagePicker from 'expo-image-picker';
import type { FileUploadResult, StoredFilePurpose } from '@smartfleet/shared-types';
import { postMultipart, UPLOAD_TIMEOUT_MS } from './client';

/** A picked picture, ready to upload. */
export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
}

export type PickImageResult =
  | { status: 'picked'; image: PickedImage }
  | { status: 'cancelled' }
  | { status: 'denied'; permission: 'camera' | 'library' };

export interface PickImageOptions {
  /** Take a photo instead of choosing one. */
  camera?: boolean;
  /** JPEG quality 0–1; 0.5 by default (UX_MOBILE §4 S5). */
  quality?: number;
}

/**
 * Lets the person take or choose a picture. Never throws for a refused permission: it returns
 * `denied`, so the screen can say how to allow it (`common.upload.cameraDenied` / `libraryDenied`).
 */
export async function pickImage({ camera = false, quality = 0.5 }: PickImageOptions = {}): Promise<PickImageResult> {
  const permission = camera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: 'denied', permission: camera ? 'camera' : 'library' };

  const options: ImagePicker.ImagePickerOptions = {
    quality,
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
  };
  const result = camera
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };

  const asset = result.assets[0];
  return {
    status: 'picked',
    image: {
      uri: asset.uri,
      fileName: asset.fileName ?? `upload-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    },
  };
}

/**
 * Uploads a picture to `POST /files/upload` (API_CONTRACT §7.10) with its `purpose`: TOPUP_PROOF for
 * a top-up screenshot. Returns the stored file; send `fileId` with the form (for example
 * `proofFileId`). Failures are ApiErrors (`FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, network).
 */
export function uploadImage(
  image: PickedImage,
  { purpose }: { purpose?: StoredFilePurpose } = {},
): Promise<FileUploadResult> {
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file part.
  form.append('file', { uri: image.uri, name: image.fileName, type: image.mimeType } as unknown as Blob);
  if (purpose) form.append('purpose', purpose);
  return postMultipart<FileUploadResult>('/files/upload', form, { timeoutMs: UPLOAD_TIMEOUT_MS });
}

export type PickAndUploadResult =
  | { status: 'uploaded'; file: FileUploadResult; image: PickedImage }
  | { status: 'cancelled' }
  | { status: 'denied'; permission: 'camera' | 'library' };

/** Picks a picture and uploads it with `purpose`. Upload failures are thrown as ApiErrors. */
export async function pickAndUploadFile(
  options: PickImageOptions & { purpose?: StoredFilePurpose } = {},
): Promise<PickAndUploadResult> {
  const picked = await pickImage(options);
  if (picked.status !== 'picked') return picked;
  const file = await uploadImage(picked.image, { purpose: options.purpose });
  return { status: 'uploaded', file, image: picked.image };
}

/**
 * @deprecated For the installed top-up screen only: picks and uploads a picture and returns its
 * signed URL, or null when cancelled. New screens use `pickAndUploadFile` and send `fileId`.
 */
export async function pickAndUploadImage(
  opts: { camera?: boolean; purpose?: StoredFilePurpose } = {},
): Promise<string | null> {
  const result = await pickAndUploadFile({ camera: opts.camera, purpose: opts.purpose, quality: 0.6 });
  if (result.status === 'cancelled') return null;
  if (result.status === 'denied') {
    throw new Error(result.permission === 'camera' ? 'Camera permission denied' : 'Photo library permission denied');
  }
  return result.file.url;
}
