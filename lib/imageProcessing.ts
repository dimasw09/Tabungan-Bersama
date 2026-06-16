export const MAX_IMAGE_SOURCE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif'
]);

const BROWSER_COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ResizeOptions = {
  maxDimension: number;
  quality: number;
};

export type PreparedImage = {
  originalFile: File;
  thumbnailFile: File | null;
  originalExtension: string;
  thumbnailExtension: string | null;
  wasCompressed: boolean;
};

export function validateImageFile(file: File, maxBytes = MAX_IMAGE_SOURCE_BYTES) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`${file.name} bukan JPG, PNG, WebP, GIF, HEIC, atau HEIF.`);
  }
  if (file.size <= 0) throw new Error(`${file.name} kosong atau rusak.`);
  if (file.size > maxBytes) throw new Error(`${file.name} lebih besar dari ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

export function imageExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/heic') return 'heic';
  if (file.type === 'image/heif') return 'heif';
  return 'jpg';
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(file);

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${file.name} tidak dapat dibaca browser.`));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageSize(image: ImageBitmap | HTMLImageElement) {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

async function resizeToWebp(file: File, options: ResizeOptions): Promise<File> {
  const image = await decodeImage(file);
  try {
    const source = imageSize(image);
    const scale = Math.min(1, options.maxDimension / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Browser tidak mendukung kompresi foto.');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Foto gagal dikompres.')), 'image/webp', options.quality);
    });
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
  } finally {
    if ('close' in image && typeof image.close === 'function') image.close();
  }
}

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  validateImageFile(file);

  // GIF dipertahankan agar animasinya tidak hilang. HEIC/HEIF dipertahankan bila browser
  // tidak mampu mendekode; thumbnail akan memakai file asli sebagai fallback.
  if (!BROWSER_COMPRESSIBLE_TYPES.has(file.type)) {
    return {
      originalFile: file,
      thumbnailFile: null,
      originalExtension: imageExtension(file),
      thumbnailExtension: null,
      wasCompressed: false
    };
  }

  try {
    const [originalFile, thumbnailFile] = await Promise.all([
      resizeToWebp(file, { maxDimension: 1920, quality: 0.84 }),
      resizeToWebp(file, { maxDimension: 480, quality: 0.72 })
    ]);
    return {
      originalFile,
      thumbnailFile,
      originalExtension: 'webp',
      thumbnailExtension: 'webp',
      wasCompressed: originalFile.size < file.size
    };
  } catch {
    return {
      originalFile: file,
      thumbnailFile: null,
      originalExtension: imageExtension(file),
      thumbnailExtension: null,
      wasCompressed: false
    };
  }
}
