import bcrypt from 'bcryptjs';
const hash = process.env.AUTH_PASSWORD_HASH;
const email = process.env.AUTH_EMAIL;
console.log('AUTH_EMAIL:', email);
console.log('AUTH_PASSWORD_HASH:', hash);
console.log('Hash present:', !!hash);
if (hash) {
  const testPw = 'admin123';
  bcrypt.compare(testPw, hash).then(result => {
    console.log(`bcrypt.compare('${testPw}', hash):`, result);
  });
}
