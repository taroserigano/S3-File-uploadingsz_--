import { fetchUserTokensById } from '@/utils/actions';

const ProfilePage = async () => {
  const userId = 'guest';
  const currentTokens = await fetchUserTokensById(userId);
  return (
    <div>
      <h2 className='mb-8 ml-8 text-xl font-extrabold'>
        Token Amount : {currentTokens}
      </h2>
      <div className='px-8'>
        <p>Guest User Profile</p>
      </div>
    </div>
  );
};
export default ProfilePage;
