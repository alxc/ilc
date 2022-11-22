export const types = {
    url: 'url',
    boolean: 'boolean',
    string: 'string',
    stringArray: 'string[]',
    enum: 'enum',
    password: 'password',
    json: 'json'
};

export function transformGet(setting) {
    setting.id = setting.key;

    if (setting.meta.type === types.enum) {
        setting.meta.choices = setting.meta.choices.map((choice) => ({
            id: choice,
            name: choice,
        }));
    }

    if (setting.default === undefined) {
        setting.default = null;
    }

    if (setting.value === undefined) {
        setting.value = null;
    }
}

export function transformSet(setting) {
    if (setting.value === null) {
        setting.value = '';
    }

    for (const key in setting) {
        if (key === 'value' || key === 'key') {
            continue;
        }

        delete setting[key];
    }
}
