import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const words = sqliteTable('words', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), term: text('term').notNull(), normTerm: text('norm_term').notNull(),
  context: text('context').notNull().default(''), normContext: text('norm_context').notNull().default(''), sense: text('sense').notNull().default(''),
  definition: text('definition').notNull().default(''), phonetic: text('phonetic').notNull().default(''), dictionary: text('dictionary').notNull().default('[]'), lookupStatus: text('lookup_status').notNull().default('pending'),
  createdAt: integer('created_at').notNull(), dueAt: integer('due_at').notNull(), intervalDays: real('interval_days').notNull().default(0), streak: integer('streak').notNull().default(0), revision: integer('revision').notNull().default(0), archivedAt: integer('archived_at')
}, t => [uniqueIndex('idx_words_identity').on(t.userId,t.normTerm,t.normContext,t.sense),index('idx_words_user_due').on(t.userId,t.archivedAt,t.dueAt)]);
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), eventKey:text('event_key').notNull(), fingerprint:text('fingerprint').notNull(), wordId:text('word_id').notNull().references(()=>words.id), term:text('term').notNull(),
  rating:text('rating').notNull(), reviewedAt:integer('reviewed_at').notNull(), dueBefore:integer('due_before').notNull(), dueAfter:integer('due_after').notNull(), intervalAfter:real('interval_after').notNull(), streakAfter:integer('streak_after').notNull(), wordRevision:integer('word_revision').notNull(), timezone:text('timezone').notNull()
},t=>[uniqueIndex('idx_reviews_user_event').on(t.userId,t.eventKey),index('idx_reviews_user_time').on(t.userId,t.reviewedAt)]);
export const limits = sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()});
