import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, ArrowRight, Image as ImageIcon } from "lucide-react";

const ImageUpload = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleNext = () => {
    if (selectedImage) {
      // Pass the image data through navigation state
      navigate('/drawing', { state: { imageData: selectedImage } });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-surface p-8">
      <div className="max-w-4xl mx-auto pt-12">
        <div className="text-center mb-12 animate-fade-in">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Upload Image
          </h1>
          <p className="text-lg text-text-soft">
            Select or drag and drop an image to get started
          </p>
        </div>

        <Card className="p-12 shadow-card animate-bounce-in">
          {!selectedImage ? (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 cursor-pointer ${
                isDragging 
                  ? 'border-primary bg-primary-light' 
                  : 'border-border hover:border-primary hover:bg-accent'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={handleUploadClick}
            >
              <div className="flex flex-col items-center gap-4">
                <div className={`p-6 rounded-full transition-colors duration-200 ${
                  isDragging ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
                }`}>
                  <Upload size={48} />
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">
                    {isDragging ? 'Drop your image here' : 'Upload an image'}
                  </p>
                  <p className="text-sm text-text-soft">
                    PNG, JPG up to 10MB
                  </p>
                </div>
                <Button variant="outline" className="mt-2">
                  <ImageIcon size={16} />
                  Choose File
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden shadow-soft">
                <img 
                  src={selectedImage} 
                  alt="Selected" 
                  className="w-full h-96 object-cover"
                />
              </div>
              <div className="flex gap-6 justify-center">
                <Button 
                  variant="outline" 
                  onClick={handleUploadClick}
                  className="px-8 py-3 text-lg"
                  size="lg"
                >
                  <Upload size={20} />
                  Change Image
                </Button>
                <Button 
                  onClick={handleNext}
                  className="px-8 py-3 text-lg"
                  size="lg"
                >
                  <ArrowRight size={20} />
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default ImageUpload;