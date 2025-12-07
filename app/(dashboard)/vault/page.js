import KnowledgeVault from "@/components/KnowledgeVault";
import { getKnowledgeDocuments } from "@/utils/actions";

const VaultPage = async () => {
  const userId = "guest";
  const documents = await getKnowledgeDocuments(userId);
  return <KnowledgeVault userId={userId} initialDocuments={documents} />;
};

export default VaultPage;
