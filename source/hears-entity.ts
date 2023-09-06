import {Composer} from 'grammy';
import {addHistoryEntity, addHistoryEntityPath, entitiesInClaimValues} from './wd-helper.js';
import {entityButtons, entityWithClaimText, image} from './format-wd-entity.js';
import {format} from './format/index.js';
import * as CLAIMS from './claim-ids.js';
import type {Context} from './bot-generics.js';

export const bot = new Composer<Context>();

bot.hears([/^\/?([qpl][1-9]\d*)$/i, /^\/start ([qpl][1-9]\d*)(?:_([qpl][1-9]\d*))?$/i], async ctx => {
	const entityId = ctx.match[1]!.toUpperCase();
	if (ctx.match[2]) {
		await addHistoryEntityPath(ctx.from?.id as number, `${ctx.match[1]!.toUpperCase()} ${ctx.match[2]!.toUpperCase()}`);
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

	await addHistoryEntity(ctx.from?.id as number, entityId, "entity");

	if (photo) {
		return ctx.replyWithPhoto(photo, {
			caption: text,
			parse_mode: format.parse_mode,
			reply_markup: {inline_keyboard},
		});
	}

	return ctx.reply(text, {
		disable_web_page_preview: true,
		parse_mode: format.parse_mode,
		reply_markup: {inline_keyboard},
	});
});
