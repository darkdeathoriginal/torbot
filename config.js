require("dotenv").config();

module.exports ={
    apiId : Number(process.env.API_ID),
    apiHash : process.env.API_HASH,
    BOT_TOKEN:process.env.BOT_TOKEN,
    sudo:Number(process.env.SUDO),
    DEVELOPMENT:process.env.STATE === undefined ? false : process.env.STATE,    
    getSudo:function(){
        return this.sudo;
    }
}