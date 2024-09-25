export const validateEnv = (required: string[]) => {
    let missen = false;
    let message = "Could not found these variables in env "
    for (const variable of required) {
        if (!process.env[variable]) {
            message += `${variable} `;
            missen = true
        }
    }
    if (missen) {
        throw new Error(message)
    }
}