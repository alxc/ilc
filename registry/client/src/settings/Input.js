import React from 'react';
import {
    ArrayInput,
    SimpleFormIterator,
    TextInput,
    RadioButtonGroupInput,
    BooleanInput,
    PasswordInput,
} from 'react-admin';
import { types } from './dataTransform';
import * as validators from '../validators';
import JsonField from '../JsonField/index';

export const Input = (props) => {
    switch(props.record.meta.type) {
        case types.url: {
            return (<TextInput source="value" fullWidth={true} validate={validators.url} />);
        }
        case types.enum: {
            return (<RadioButtonGroupInput row={false} source="value" choices={props.record.meta.choices} />);
        }
        case types.boolean: {
            return (<BooleanInput source="value" />);
        }
        case types.password: {
            return (<PasswordInput source="value" fullWidth={true} />);
        }
        case types.stringArray: {
            return (
                <ArrayInput source="value">
                    <SimpleFormIterator>
                        <TextInput fullWidth={true} />
                    </SimpleFormIterator>
                </ArrayInput>
            );
        }
        case types.json: {
            return <JsonField source="value" label="CSP configuration JSON" />
        }
        default: {
            return (<TextInput multiline source="value" fullWidth={true} />);
        }
    }
};
