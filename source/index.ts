import {readFileSync} from 'node:fs';
import {Bot, session} from 'grammy';
import {FileAdapter} from '@grammyjs/storage-file';
import {generateUpdateMiddleware} from 'telegraf-middleware-console-time';
import {I18n} from '@grammyjs/i18n';
import {MenuMiddleware} from 'grammy-inline-menu';
import {resourceKeysFromYaml, TelegrafWikibase} from 'telegraf-wikibase';
import {bot as hearsEntity} from './hears-entity.js';
import {bot as inlineSearch} from './inline-search.js';
import {bot as locationSearch} from './location-search.js';
import {menu as languageMenu} from './language-menu.js';
import type {Context, Session} from './bot-generics.js';
import {InlineKeyboardButton} from 'grammy/types';
import {buildSparQLQuery, createResultsString, entitiesInClaimValues, getHistoryEntities, getHistoryEntitiesPaths, getSparQLQuery, initializeSparQLQuery, querySparql, updateSparQLQuery} from './wd-helper.js';
import {entityButtons, entityWithClaimText, image} from './format-wd-entity.js';
import * as CLAIMS from './claim-ids.js';
import {format} from './format/index.js';

(process as any).title = 'wikidata-tgbot';

const token = process.env['BOT_TOKEN'];
if (!token) {
	throw new Error(
		'You have to provide the bot-token from @BotFather via environment variable (BOT_TOKEN)',
	);
}

export const i18n = new I18n({
	defaultLocale: 'en',
	directory: 'locales',
	useSession: true,
});

const twb = new TelegrafWikibase({
	contextKey: 'wd',
	logQueriedEntityIds: process.env['NODE_ENV'] !== 'production',
	userAgent: 'EdJoPaTo/wikidata-telegram-bot',
});
const wikidataResourceKeyYaml = readFileSync('wikidata-items.yaml', 'utf8');
twb.addResourceKeys(resourceKeysFromYaml(wikidataResourceKeyYaml));

export const baseBot = new Bot<Context>(token);

const bot = baseBot.errorBoundary(async ({error}) => {
	if (error instanceof Error && error.message.startsWith('400: Bad Request: query is too old')) {
		return;
	}

	console.error('BOT ERROR', error);
});

bot.use(session({
	initial: (): Session => ({}),
	storage: new FileAdapter({dirName: 'persist/sessions/'}),
	getSessionKey(ctx) {
		// TODO: remove once https://github.com/grammyjs/grammY/pull/89 is released
		const chatInstance = ctx.chat?.id
			?? ctx.callbackQuery?.chat_instance
			?? ctx.from?.id;
		return chatInstance?.toString();
	},
}));

bot.use(async (ctx, next) => {
	if (!ctx.state) {
		// @ts-expect-error set readonly property
		ctx.state = {};
	}

	return next();
});

bot.use(i18n.middleware());
bot.use(twb.middleware());

if (process.env['NODE_ENV'] !== 'production') {
	bot.use(generateUpdateMiddleware());
}

bot.use(hearsEntity.middleware());
bot.use(inlineSearch.middleware());
bot.use(locationSearch.middleware());

const languageMenuMiddleware = new MenuMiddleware('/', languageMenu);

bot.command(
	['lang', 'language', 'settings'],
	async ctx => languageMenuMiddleware.replyToContext(ctx),
);
bot.hears(
	'/start language',
	async ctx => languageMenuMiddleware.replyToContext(ctx),
);

bot.hears(
	['/start history', '/history'],
	async ctx => {
		const text = ctx.t('history-choose');
		return ctx.reply(text, {
			reply_markup: {
				inline_keyboard: [
					[{
						text: 'Entities',
						callback_data: 'entities-history'
					}],
					[{
						text: 'Locations',
						callback_data: 'locations-history'
					}],
					[{
						text: 'Last 5 paths',
						callback_data: 'paths-history'
					}]
				]
			}
		});
	}
)

bot.callbackQuery("entities-history", async (ctx) => {
	const buttons: InlineKeyboardButton[] = [];
	const history = await getHistoryEntities(ctx.from.id, "entity");
	if (history.length < 1) {
		return ctx.editMessageText(ctx.t('history-empty'));
	}
	const buttonPromises = history.map(async (entity) => {
        const label = (await ctx.wd.reader(entity)).label();
        return {
            text: label,
            callback_data: `entity-${entity}`
        };
    });
	buttons.push(...await Promise.all(buttonPromises));
	await ctx.editMessageText(ctx.t("history-show"), {
		reply_markup: {
			inline_keyboard: buttons.map((button) => [button])
		}
	});
	return ctx.answerCallbackQuery();
});

bot.callbackQuery("locations-history", async (ctx) => {
	const buttons: InlineKeyboardButton[] = [];
	const history = await getHistoryEntities(ctx.from.id, "location");
	if (history.length < 1) {
		return ctx.editMessageText(ctx.t('history-empty'));
	}
	const buttonPromises = history.map(async (entity) => {
		return {
			text: entity,
			callback_data: `location:${entity}`
		};
	});
	buttons.push(...await Promise.all(buttonPromises));
	await ctx.editMessageText(ctx.t("history-show"), {
		reply_markup: {
			inline_keyboard: buttons.map((button) => [button])
		}
	});
	return ctx.answerCallbackQuery();
});

bot.callbackQuery("paths-history", async (ctx) => {
	const buttons: InlineKeyboardButton[] = [];
	const history = await getHistoryEntitiesPaths(ctx.from.id);

	if (history.length < 1) {
		return ctx.editMessageText(ctx.t('history-empty'));
	}
	const buttonPromises = history.map(async (entity) => {
		const label = (await ctx.wd.reader(entity)).label();
		return {
			text: label,
			callback_data: `entity-${entity}`
		};
	});
	buttons.push(...await Promise.all(buttonPromises));
	await ctx.editMessageText(ctx.t("history-show"), {
		reply_markup: {
			inline_keyboard: buttons.map((button) => [button])
		}
	});
	return ctx.answerCallbackQuery();
});

bot.on('callback_query:data', async (ctx) => {
	const entityId = ctx.callbackQuery.data.match(/entity-(Q\d+)/)?.[1] ?? "";
	if (entityId === "") {
		return ctx.answerCallbackQuery();
	}
	const entity = await ctx.wd.reader(entityId);

	const claimEntityIds = entitiesInClaimValues([entity], CLAIMS.TEXT_INTEREST);
	await ctx.wd.preload([...claimEntityIds, ...CLAIMS.ALL]);

	const text = await entityWithClaimText(
		ctx.wd,
		entityId,
		CLAIMS.TEXT_INTEREST,
	);

	const buttons = await entityButtons(ctx.wd, entityId);
	const inline_keyboard = buttons.map(o => [o]);

	const {photo} = image(entity);

	if (photo) {
		await ctx.deleteMessage();
		return ctx.replyWithPhoto(photo, {
			caption: text,
			parse_mode: format.parse_mode,
			reply_markup: {inline_keyboard},
		});
	}

	return ctx.editMessageText(text, {
		disable_web_page_preview: true,
		parse_mode: format.parse_mode,
		reply_markup: {inline_keyboard},
	});
});

bot.command(['sparql', 'query'], async ctx => {
	const text = ctx.t('sparql-send-subject');
	await initializeSparQLQuery(ctx.from?.id as number);
	return ctx.reply(text);
});

bot.use(languageMenuMiddleware);

bot.command(['start', 'help', 'search'], async ctx => {
	const text = ctx.t('help');
	return ctx.reply(text, {
		reply_markup: {
			inline_keyboard: [[{
				text: 'inline search…',
				switch_inline_query_current_chat: '',
			}], [{
				text: '🦑GitHub',
				url: 'https://github.com/EdJoPaTo/wikidata-telegram-bot',
			}]],
		},
	});
});

//failed impagination
/*async function menuBody(ctx: Context, _path: string): Promise<Body> {
	const query = await buildSparQLQuery(ctx.from?.id as number);
	const results = await querySparql(query);
	await ctx.wd.preload(results.map(o => o.predicate.value));
	ctx.state.locationTotalPages = results.length / 10;
	const text = await createResultsString(ctx, results, ctx.session.locationPage ?? 0) as string;
	console.log(text);
	console.log(ctx.session.locationPage);
	if (text === "") {
		return ctx.reply(ctx.t('sparql-no-results'));
	}
	return {
		text,
		parse_mode: format.parse_mode,
		disable_web_page_preview: true,
	};
}

const menu = new MenuTemplate<Context>(menuBody);

menu.pagination('page', {
	getTotalPages: ctx => ctx.state.locationTotalPages ?? 1,
	getCurrentPage: ctx => (ctx.session.locationPage ?? 0) + 1,
	setPage(ctx, page) {
		ctx.session.locationPage = page - 1;
	},
});

const sparqlMenuMiddleware = new MenuMiddleware(/^sciao\//, menu);
bot.use(sparqlMenuMiddleware.middleware());*/

bot.on('message:text' , async ctx => {
	//handle sparql query statuses to set subject, predicate and object
	const sparqlStatus = await getSparQLQuery(ctx.from?.id as number);
	if (sparqlStatus.status === 0) {
		await updateSparQLQuery(ctx.from?.id as number, ctx.message.text.toLowerCase(), "", "", 1);
		const text = ctx.t('sparql-send-predicate');
		return ctx.reply(text);
	} else if (sparqlStatus.status === 1) {
		await updateSparQLQuery(ctx.from?.id as number, sparqlStatus.subject, ctx.message.text.toLowerCase(), "", 2);
		const text = ctx.t('sparql-send-object');
		return ctx.reply(text);
	} else if (sparqlStatus.status === 2) {
		await updateSparQLQuery(ctx.from?.id as number, sparqlStatus.subject, sparqlStatus.predicate, ctx.message.text.toLowerCase(), 3);
		//return sparqlMenuMiddleware.replyToContext(ctx, "sciao/");
		const query = await buildSparQLQuery(ctx.from?.id as number);
		const raw = await querySparql(query);
		const text_s = await createResultsString(ctx, raw, ctx.session.locationPage ?? 0);
		if (text_s === "") {
			return ctx.reply(ctx.t('sparql-no-results'));
		}
		return ctx.reply(text_s, {
			parse_mode: format.parse_mode,
			disable_web_page_preview: true,
		});
	}
	return;
});

await baseBot.api.setMyCommands([
	{
		command: 'location',
		description: 'Show info on how to use the location feature',
	},
	{command: 'help', description: 'Show help'},
	{command: 'language', description: 'set your language'},
	{command: 'settings', description: 'set your language'},
]);

await baseBot.start({
	onStart(botInfo) {
		console.log(new Date(), 'Bot starts as', botInfo.username);
	},
});
