-- ---------------------------------------------------------------------------
-- 0.7.0 - accept SVG in user-media as a fallback
--
-- The client rasterises SVG to WebP before upload, but older browsers or a
-- decode failure can still send the original SVG. The bucket previously
-- rejected it with "mime type image/svg+xml is not supported".
-- ---------------------------------------------------------------------------

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
]
where id = 'user-media';

notify pgrst, 'reload schema';
