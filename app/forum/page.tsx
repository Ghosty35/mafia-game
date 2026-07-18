'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRouter } from 'next/navigation';
import Panel from '../components/Panel';

export const dynamic = 'force-dynamic';

type Post = {
  id: string;
  category_id: string;
  author_id: string;
  author_name: string;
  title: string;
  content: string;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
  reply_count: number;
  last_reply_at: string;
};

type Category = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
};

const CATEGORY_ICONS: Record<string, string> = {
  general: '💬',
  recruitment: '🤝',
  announcements: '📢',
};

export default function ForumPage() {
  const { player, refreshPlayer } = usePlayer();
  const { t, fm } = useLanguage();
  const router = useRouter();
  const supabase = createClient();

  const [categories, setCategories] = useState<Category[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.rpc('list_forum_categories');
    if (data) setCategories(data as Category[]);
  }, [supabase]);

  const loadPosts = useCallback(async () => {
    const { data } = await supabase.rpc('list_forum_posts', {
      p_category_id: activeCategory,
    });
    if (data) setPosts(data as Post[]);
    setLoading(false);
  }, [supabase, activeCategory]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleCreatePost = async () => {
    if (!player) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('create_forum_post', {
      p_category_id: newCategory,
      p_title: newTitle,
      p_content: newContent,
    });
    setBusy(false);
    if (err) {
      if (err.message.includes('BANNED')) setError(t('dl_err_banned'));
      else if (err.message.includes('TIMED_OUT')) setError(t('dl_err_timed_out'));
      else if (err.message.includes('TITLE_TOO_SHORT')) setError('Title must be at least 3 characters.');
      else if (err.message.includes('CONTENT_TOO_SHORT')) setError('Content cannot be empty.');
      else setError(err.message || 'Failed to create post.');
      return;
    }
    setNewTitle('');
    setNewContent('');
    setShowNewPost(false);
    await loadPosts();
    if (refreshPlayer) await refreshPlayer();
  };

  if (!player) return <div className="max-w-5xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">📢 {t('forum_title')}</h1>
          <p className="text-xs text-zinc-400">{t('forum_subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNewPost(!showNewPost)}
          className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold shrink-0"
        >
          {showNewPost ? t('common_cancel') : t('forum_new_post')}
        </button>
      </div>

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-2.5 rounded-lg text-sm">{error}</div>}

      {/* New Post Form */}
      {showNewPost && (
        <Panel title={t('forum_new_post')} icon="✍️">
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('forum_category')}</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {CATEGORY_ICONS[c.id] || '📄'} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('forum_title_label')}</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('forum_title_placeholder')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                maxLength={120}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{t('forum_content_label')}</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('forum_content_placeholder')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm h-32 resize-y"
                maxLength={5000}
              />
            </div>
            <button
              onClick={handleCreatePost}
              disabled={busy || !newTitle.trim() || !newContent.trim()}
              className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? t('forum_posting') : t('forum_post_button')}
            </button>
          </div>
        </Panel>
      )}

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            activeCategory === null
              ? 'bg-red-900/50 border-red-700 text-red-300'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
          }`}
        >
          {t('forum_all_categories')}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              activeCategory === c.id
                ? 'bg-red-900/50 border-red-700 text-red-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            {CATEGORY_ICONS[c.id] || '📄'} {c.name}
          </button>
        ))}
      </div>

      {/* Posts List */}
      <Panel title={t('forum_posts')} icon="📋" bodyClassName="p-0">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('loading')}</div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">{t('forum_no_posts')}</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/forum/${post.id}`}
                className="block px-4 py-3 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-lg shrink-0">
                    {CATEGORY_ICONS[post.category_id] || '📄'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.is_pinned && <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded font-semibold">PINNED</span>}
                      {post.is_locked && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded font-semibold">LOCKED</span>}
                      <span className="font-semibold text-sm truncate">{post.title}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      by <span className="text-zinc-300">{post.author_name}</span> • {new Date(post.created_at).toLocaleDateString()} • {post.reply_count} {t('forum_replies')}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
