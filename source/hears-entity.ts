import {Composer} from 'grammy';

import {Context} from './bot-generics';
import {entitiesInClaimValues} from './wd-helper';
import {entityWithClaimText, entityButtons, image} from './format-wd-entity';
import {format} from './format';
import * as CLAIMS from './claim-ids';

export const bot = new Composer<Context>();

bot.hears(/^\/?([qpl][1-9]\d*)$/i, async ctx => {
	const entityId = ctx.match[1]!.toUpperCase();
	const entity = await ctx.wd.reader(entityId);

	const claimEntityIds = entitiesInClaimValues(entity, CLAIMS.TEXT_INTEREST);
	await ctx.wd.preload([...claimEntityIds, ...CLAIMS.TEXT_INTEREST]);

	const text = await entityWithClaimText(ctx.wd, entityId, CLAIMS.TEXT_INTEREST);

	const buttons = await entityButtons(ctx.wd, entityId);
	const inline_keyboard = buttons.map(o => [o]);

	const {photo} = image(entity);

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
