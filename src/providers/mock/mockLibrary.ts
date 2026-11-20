import type { MediaItem } from '../../core/media';

/** Offline library for the mock Spotify / Music Assistant players. */
interface Node {
  readonly title: string;
  readonly cls: string;
  readonly artist?: string;
  readonly children?: readonly string[];
}

const NODES: Readonly<Record<string, Node>> = {
  root: { title: 'Library', cls: 'directory', children: ['artists', 'playlists', 'albums', 'radio'] },
  artists: { title: 'Artists', cls: 'directory', children: ['ar:fleetwood', 'ar:neil', 'ar:miles'] },
  'ar:fleetwood': { title: 'Fleetwood Mac', cls: 'artist', children: ['al:rumours'] },
  'ar:neil': { title: 'Neil Young', cls: 'artist', children: ['al:harvest'] },
  'ar:miles': { title: 'Miles Davis', cls: 'artist', children: ['tr:so_what'] },
  playlists: { title: 'Playlists', cls: 'directory', children: ['pl:dinner', 'pl:focus', 'pl:road'] },
  albums: { title: 'Albums', cls: 'directory', children: ['al:rumours', 'al:harvest'] },
  radio: { title: 'Radio', cls: 'directory', children: ['st:kexp', 'st:jazz'] },
  'pl:dinner': { title: 'Dinner Jazz', cls: 'playlist', children: ['tr:so_what', 'tr:take_five'] },
  'pl:focus': { title: 'Deep Focus', cls: 'playlist', children: ['tr:weightless'] },
  'pl:road': { title: 'Road Trip', cls: 'playlist', children: ['tr:dreams', 'tr:go_your_own_way', 'tr:heart_of_gold'] },
  'al:rumours': { title: 'Rumours', cls: 'album', artist: 'Fleetwood Mac', children: ['tr:dreams', 'tr:go_your_own_way'] },
  'al:harvest': { title: 'Harvest', cls: 'album', artist: 'Neil Young', children: ['tr:heart_of_gold', 'tr:harvest_moon'] },
  'st:kexp': { title: 'KEXP 90.3', cls: 'channel' },
  'st:jazz': { title: 'Jazz 24', cls: 'channel' },
  'tr:so_what': { title: 'So What', cls: 'track', artist: 'Miles Davis' },
  'tr:take_five': { title: 'Take Five', cls: 'track', artist: 'The Dave Brubeck Quartet' },
  'tr:weightless': { title: 'Weightless', cls: 'track', artist: 'Marconi Union' },
  'tr:dreams': { title: 'Dreams', cls: 'track', artist: 'Fleetwood Mac' },
  'tr:go_your_own_way': { title: 'Go Your Own Way', cls: 'track', artist: 'Fleetwood Mac' },
  'tr:heart_of_gold': { title: 'Heart of Gold', cls: 'track', artist: 'Neil Young' },
  'tr:harvest_moon': { title: 'Harvest Moon', cls: 'track', artist: 'Neil Young' },
};

const toItem = (id: string, node: Node, withChildren: boolean): MediaItem => {
  const children = withChildren ? (node.children ?? []).flatMap((c) => (NODES[c] ? [toItem(c, NODES[c], false)] : [])) : undefined;
  return {
    title: node.title,
    mediaClass: node.cls,
    contentId: id,
    contentType: node.cls === 'directory' ? 'library' : node.cls,
    canPlay: node.cls !== 'directory',
    canExpand: node.children !== undefined,
    ...(children ? { children } : {}),
  };
};

/** Browse result for a content id ('' = root). */
export const mockBrowse = (contentId: string | undefined): MediaItem | null => {
  const id = contentId || 'root';
  const node = NODES[id];
  return node ? toItem(id, node, true) : null;
};

/** Title (or artist) match across the library, optionally limited to media classes. */
export const mockSearch = (query: string, classes?: readonly string[]): MediaItem[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.entries(NODES)
    .filter(([, n]) => n.cls !== 'directory' && (!classes?.length || classes.includes(n.cls)))
    .filter(([, n]) => n.title.toLowerCase().includes(q) || (n.artist?.toLowerCase().includes(q) ?? false))
    .map(([id, n]) => toItem(id, n, false));
};

/** What `play_media` on an id would show as now playing: first track + artist. */
export const mockNowPlaying = (contentId: string): { title: string; artist: string } | null => {
  const node = NODES[contentId];
  if (!node) return null;
  // Depth-first: artists hold albums, albums hold tracks.
  const firstTrack = (n: Node): Node | undefined =>
    n.cls === 'track' ? n : (n.children ?? []).map((c) => NODES[c]).reduce<Node | undefined>((found, c) => found ?? (c ? firstTrack(c) : undefined), undefined);
  const track = firstTrack(node);
  if (node.cls === 'channel') return { title: node.title, artist: 'Live radio' };
  return track ? { title: track.title, artist: track.artist ?? node.artist ?? '' } : null;
};
