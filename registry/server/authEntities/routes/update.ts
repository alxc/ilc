import { Request, Response } from 'express';
import Joi from 'joi';

import db from '../../db';
import validateRequestFactory from '../../common/services/validateRequest';
import preProcessResponse from '../../common/services/preProcessResponse';
import AuthEntity, { updateSchema } from '../interfaces';
import * as bcrypt from 'bcrypt';

type RequestParams = {
    id: string;
};

const validateRequest = validateRequestFactory([
    {
        schema: Joi.object({
            id: Joi.number().required(),
        }),
        selector: 'params',
    },
    {
        schema: updateSchema,
        selector: 'body',
    },
]);

const updateSharedProps = async (req: Request<RequestParams>, res: Response): Promise<void> => {
    const input = req.body;
    const recordId = req.params.id;

    const countToUpdate = await db('auth_entities').where({ id: recordId });
    if (!countToUpdate.length) {
        res.status(404).send('Not found');
        return;
    }

    if (input.secret) {
        input.secret = await bcrypt.hash(input.secret, await bcrypt.genSalt());
    }

    await db.versioning(req.user, { type: 'auth_entities', id: recordId }, async (trx) => {
        await db('auth_entities').where({ id: recordId }).update(input).transacting(trx);
    });

    const [updatedRecord] = await db.select().from<AuthEntity>('auth_entities').where('id', recordId);

    delete updatedRecord.secret;
    res.status(200).send(preProcessResponse(updatedRecord));
};

export default [validateRequest, updateSharedProps];
