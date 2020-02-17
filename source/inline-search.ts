import {Composer, Markup} from 'telegraf';
import {InlineQueryResult} from 'telegram-typings';
import {searchEntities} from 'wikidata-sdk-got';
import {SearchResult} from 'wikidata-sdk';
import arrayFilterUnique from 'array-filter-unique';
import WikidataEntityReader from 'wikidata-entity-reader';
import WikidataEntityStore from 'wikidata-entity-store';

import {entitiesInClaimValues, getPopularEntities} from './wd-helper';
import {entityWithClaimText, entityButtons, image} from './format-wd-entity';
import * as CLAIMS from './claim-ids';

function genCharArray(charA: string, charZ: string): string[] {
	const result = [];
	for (let i = charA.charCodeAt(0); i <= charZ.charCodeAt(0); i++) {
		result.push(String.fromCharCode(i));
	}

	return result;
}

export async function init(store: WikidataEntityStore): Promise<void> {
	const alphabet = genCharArray('A', 'Z');
	const resultArrArr = await Promise.all(
		alphabet.map(async o => search('en', o))
	);

	const entityIds = resultArrArr
		.flat()
		.map(o => o.id)
		.filter(arrayFilterUnique());

	await preload(store, entityIds);
}

/* eslint @typescript-eslint/camelcase: off */
export const bot = new Composer();

async function getSearchResults(language: string, query: string): Promise<string[]> {
	if (query) {
		const results = await search(language, query);
		return results.map(o => o.id);
	}

	return getPopularEntities();
}

bot.on('inline_query', async ctx => {
	const {query} = ctx.inlineQuery!;
	const language = (ctx as any).wd.locale();

	const identifier = `inline query ${Number(ctx.inlineQuery!.id).toString(36).slice(-4)} ${ctx.from!.id} ${ctx.from!.first_name} ${language} ${query.length} ${query}`;
	console.time(identifier);

	const store = (ctx as any).wd.store as WikidataEntityStore;

	const searchResults = await getSearchResults(language, query);
	console.timeLog(identifier, 'search', searchResults.length);

	await preload(store, searchResults);
	console.timeLog(identifier, 'preload');

	const inlineResults = searchResults
		.map(o => createInlineResult(ctx, o));

	const options = {
		switch_pm_text: '🏳️‍🌈 ' + ((ctx as any).wd.r('menu.language') as WikidataEntityReader).label(),
		switch_pm_parameter: 'language',
		is_personal: true,
		cache_time: 20
	};

	if (process.env.NODE_ENV !== 'production') {
		options.cache_time = 2;
	}

	console.timeEnd(identifier);

	return ctx.answerInlineQuery([
		...inlineResults
	], options);
});

async function search(language: string, query: string): Promise<SearchResult[]> {
	const options = {
		search: query,
		language,
		continue: 0,
		limit: 10
	};

	const result = await searchEntities(options);
	return result.search;
}

async function preload(store: WikidataEntityStore, entityIds: string[]): Promise<void> {
	await store.preloadQNumbers(...entityIds);

	const entities = entityIds
		.map(id => new WikidataEntityReader(store.entity(id)));
	const claimEntityIds = entitiesInClaimValues(entities, CLAIMS.TEXT_INTEREST);
	await store.preloadQNumbers(...claimEntityIds);
}

function createInlineResult(ctx: any, entityId: string): InlineQueryResult {
	const entity = ctx.wd.r(entityId) as WikidataEntityReader;

	const text = entityWithClaimText(ctx.wd.store, entityId, CLAIMS.TEXT_INTEREST, ctx.wd.locale());

	const keyboard = Markup.inlineKeyboard(
		entityButtons(ctx.wd.store, entityId, ctx.wd.locale()) as any[],
		{columns: 1}
	);

	const {photo, thumb} = image(entity);

	const inlineResult: InlineQueryResult = {
		type: photo ? 'photo' : 'article',
		id: entityId,
		title: entity.label(),
		description: entity.description(),
		photo_url: photo!,
		thumb_url: thumb!,
		parse_mode: 'html',
		reply_markup: keyboard
	};

	if (photo) {
		inlineResult.caption = text;
	} else {
		inlineResult.input_message_content = {
			message_text: text,
			disable_web_page_preview: true,
			parse_mode: 'html'
		};
	}

	return inlineResult;
}
